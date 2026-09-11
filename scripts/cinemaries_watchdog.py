#!/usr/bin/env python3
"""CINÉMARIÉS internal watchdog.

Runs every 5 minutes via cron. Performs deep health checks and sends SMS
alerts via Brevo when problems are detected. Uses cooldowns to avoid
SMS flooding.

Checks:
    1. Backend FastAPI  (curl http://127.0.0.1:8001/api/)
    2. MongoDB          (mongosh ping)
    3. Disk space       (/ and /srv > 500 Mo free)
    4. SSL certificate  (< 15 days until expiry)
    5. Backend service  (systemctl is-active)
    6. Nginx service    (systemctl is-active)

State file at STATE_FILE tracks last status + last alert time per check.
When a check transitions FAIL → OK, a "recovery" SMS is sent.

Environment:
    Reads BREVO_API_KEY and BREVO_SMS_SENDER from
    /var/www/cinemaries/backend/.env
"""
from __future__ import annotations

import os
import sys
import json
import time
import socket
import ssl as ssllib
import shutil
import logging
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
ENV_FILE = "/var/www/cinemaries/backend/.env"
STATE_FILE = "/var/lib/cinemaries-watchdog/state.json"
LOG_FILE = "/var/log/cinemaries-watchdog.log"

ALERT_PHONES = ["+33612743369"]  # E.164 format
COOLDOWN_MINUTES = 60           # min between same-type alerts
DISK_MIN_FREE_MB = 500
SSL_DOMAIN = "cinemaries.fr"
SSL_MIN_DAYS = 15
BACKEND_URL = "http://127.0.0.1:8001/api/"
MONGO_DB = "cinemaries"
SYSTEMD_UNITS = ["cinemaries-backend", "nginx"]

BREVO_URL = "https://api.brevo.com/v3/transactionalSMS/send"

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
Path("/var/lib/cinemaries-watchdog").mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("watchdog")


# -----------------------------------------------------------------------------
# .env parser
# -----------------------------------------------------------------------------
def load_env(path: str) -> dict:
    env = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        log.warning(".env file not found: %s", path)
    return env


ENV = load_env(ENV_FILE)
BREVO_API_KEY = ENV.get("BREVO_API_KEY", "").strip()
BREVO_SMS_SENDER = ENV.get("BREVO_SMS_SENDER", "CINEMARIES").strip()[:11] or "CINEMARIES"


# -----------------------------------------------------------------------------
# State
# -----------------------------------------------------------------------------
def load_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.warning("state load failed: %s", e)
        return {}


def save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# -----------------------------------------------------------------------------
# SMS
# -----------------------------------------------------------------------------
def send_sms(content: str, tag: str) -> bool:
    if not BREVO_API_KEY:
        log.error("BREVO_API_KEY missing in %s", ENV_FILE)
        return False
    ok_all = True
    for phone in ALERT_PHONES:
        payload = json.dumps({
            "sender": BREVO_SMS_SENDER,
            "recipient": phone,
            "content": content[:160],
            "type": "transactional",
            "tag": tag,
            "unicodeEnabled": False,
        }).encode("utf-8")
        req = urllib.request.Request(
            BREVO_URL,
            data=payload,
            headers={
                "accept": "application/json",
                "api-key": BREVO_API_KEY,
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 201:
                    body = json.loads(resp.read().decode())
                    log.info("SMS sent to %s tag=%s msgId=%s", phone[-4:], tag, body.get("messageId"))
                else:
                    log.warning("SMS unexpected status %s", resp.status)
                    ok_all = False
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode()[:200]
            except Exception:
                pass
            log.error("SMS HTTPError %s: %s", e.code, err_body)
            ok_all = False
        except Exception as e:
            log.error("SMS exception: %s", e)
            ok_all = False
    return ok_all


# -----------------------------------------------------------------------------
# Checks — each returns (ok: bool, detail: str)
# -----------------------------------------------------------------------------
def check_backend() -> tuple[bool, str]:
    try:
        req = urllib.request.Request(BACKEND_URL, headers={"User-Agent": "watchdog"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return True, "200 OK"
            return False, f"HTTP {resp.status}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def check_mongo() -> tuple[bool, str]:
    try:
        r = subprocess.run(
            ["mongosh", MONGO_DB, "--quiet", "--eval", "db.runCommand({ping:1}).ok"],
            capture_output=True, text=True, timeout=10,
        )
        out = (r.stdout or "").strip()
        if r.returncode == 0 and "1" in out:
            return True, "ping=1"
        return False, f"rc={r.returncode} out={out[:100]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def check_disk() -> tuple[bool, str]:
    failing = []
    details = []
    for path in ("/", "/srv"):
        try:
            usage = shutil.disk_usage(path)
            free_mb = usage.free // (1024 * 1024)
            details.append(f"{path}={free_mb}Mo")
            if free_mb < DISK_MIN_FREE_MB:
                failing.append(f"{path}={free_mb}Mo")
        except Exception as e:
            failing.append(f"{path}={type(e).__name__}")
    if failing:
        return False, "LOW: " + ", ".join(failing)
    return True, ", ".join(details)


def check_ssl() -> tuple[bool, str]:
    try:
        ctx = ssllib.create_default_context()
        with socket.create_connection((SSL_DOMAIN, 443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=SSL_DOMAIN) as ssock:
                cert = ssock.getpeercert()
        expiry = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days = (expiry - datetime.now(timezone.utc)).days
        if days < SSL_MIN_DAYS:
            return False, f"expires in {days}d"
        return True, f"{days}d left"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def check_systemd_unit(unit: str) -> tuple[bool, str]:
    try:
        r = subprocess.run(
            ["systemctl", "is-active", unit],
            capture_output=True, text=True, timeout=5,
        )
        state = (r.stdout or "").strip()
        return state == "active", state or "unknown"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


# -----------------------------------------------------------------------------
# Main run
# -----------------------------------------------------------------------------
def process_check(state: dict, key: str, label: str, ok: bool, detail: str, now: datetime, alerts: list, recoveries: list):
    prev = state.get(key, {})
    prev_status = prev.get("status")
    last_alert_iso = prev.get("last_alert_at")

    can_alert = True
    if last_alert_iso:
        try:
            last_alert = datetime.fromisoformat(last_alert_iso)
            if (now - last_alert).total_seconds() < COOLDOWN_MINUTES * 60:
                can_alert = False
        except Exception:
            pass

    if not ok:
        # Down
        if prev_status != "down" or can_alert:
            alerts.append(f"❌ {label}: {detail}")
            state[key] = {
                "status": "down",
                "last_change_at": utcnow(),
                "last_alert_at": utcnow(),
                "detail": detail,
            }
            log.warning("%s DOWN: %s", label, detail)
        else:
            # still down but cooldown active, don't alert
            state[key] = {
                **prev,
                "status": "down",
                "detail": detail,
            }
            log.info("%s still DOWN (cooldown): %s", label, detail)
    else:
        # OK
        if prev_status == "down":
            recoveries.append(f"✅ {label}: OK ({detail})")
            log.info("%s RECOVERED: %s", label, detail)
        state[key] = {
            "status": "up",
            "last_check_at": utcnow(),
            "detail": detail,
        }


def main():
    log.info("--- watchdog run start ---")
    state = load_state()
    now = datetime.now(timezone.utc)
    alerts: list = []
    recoveries: list = []

    # Backend
    ok, det = check_backend()
    process_check(state, "backend", "API Backend", ok, det, now, alerts, recoveries)

    # Mongo
    ok, det = check_mongo()
    process_check(state, "mongodb", "MongoDB", ok, det, now, alerts, recoveries)

    # Disk
    ok, det = check_disk()
    process_check(state, "disk", "Disque", ok, det, now, alerts, recoveries)

    # SSL
    ok, det = check_ssl()
    process_check(state, "ssl", "SSL cert", ok, det, now, alerts, recoveries)

    # Systemd units
    for unit in SYSTEMD_UNITS:
        ok, det = check_systemd_unit(unit)
        process_check(state, f"unit_{unit}", f"Service {unit}", ok, det, now, alerts, recoveries)

    # Send SMS if needed
    if alerts:
        msg = "CINEMARIES ALERTE: " + " | ".join(alerts)
        send_sms(msg, "watchdog_down")
    if recoveries:
        msg = "CINEMARIES RECUP: " + " | ".join(recoveries)
        send_sms(msg, "watchdog_up")

    state["last_run_at"] = utcnow()
    save_state(state)
    log.info("--- watchdog run done alerts=%d recoveries=%d ---", len(alerts), len(recoveries))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.exception("FATAL: %s", e)
        sys.exit(1)
