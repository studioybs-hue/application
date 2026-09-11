"""Admin settings module — persist SMTP (and future) configuration in DB.

Stored in `app_settings` collection as one doc per key:
  { key: "smtp", value: {...}, updated_at, updated_by }
  { key: "brevo_sms", value: {...}, updated_at, updated_by }

Design goals:
  - Values stored in DB take precedence over environment variables (so admins
    can update creds without redeploying / SSHing).
  - Mailer & Brevo helpers query this module via `get_smtp_config()` etc.
  - Passwords are stored as-is (same as .env); DB is behind auth. Admin UI
    displays a masked value and never returns the plain password.
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, EmailStr

log = logging.getLogger("app_settings")

# In-memory cache with short TTL to avoid hammering Mongo on every email
_CACHE: dict[str, tuple[dict, datetime]] = {}
_CACHE_TTL_SEC = 30


def _utcnow():
    return datetime.now(timezone.utc)


def _mask_password(pwd: Optional[str]) -> str:
    if not pwd:
        return ""
    if len(pwd) <= 4:
        return "•" * len(pwd)
    return pwd[:2] + "•" * (len(pwd) - 4) + pwd[-2:]


# ---------------------------------------------------------------------------
# Setter (async) — fetch from Mongo with cache, fallback to env
# ---------------------------------------------------------------------------
async def _fetch(db, key: str) -> Optional[dict]:
    now = _utcnow()
    cached = _CACHE.get(key)
    if cached and (now - cached[1]).total_seconds() < _CACHE_TTL_SEC:
        return cached[0]
    doc = await db.app_settings.find_one({"key": key}, {"_id": 0, "value": 1})
    val = (doc or {}).get("value")
    if val is not None:
        _CACHE[key] = (val, now)
    return val


async def get_smtp_config(db) -> dict:
    """Return effective SMTP config. DB > env fallback."""
    db_val = await _fetch(db, "smtp")
    env_val = {
        "host": os.environ.get("SMTP_HOST", ""),
        "port": int(os.environ.get("SMTP_PORT", "465") or 465),
        "user": os.environ.get("SMTP_USER", ""),
        "password": os.environ.get("SMTP_PASSWORD", ""),
        "from_email": os.environ.get("SMTP_FROM_EMAIL", "") or os.environ.get("SMTP_USER", ""),
        "from_name": os.environ.get("SMTP_FROM_NAME", "CINÉMARIÉS"),
        "use_ssl": (os.environ.get("SMTP_USE_SSL", "true").lower() in ("1", "true", "yes")),
    }
    if not db_val:
        return env_val
    # merge db over env
    merged = {**env_val, **db_val}
    # ensure types
    try:
        merged["port"] = int(merged.get("port") or 465)
    except Exception:
        merged["port"] = 465
    merged["use_ssl"] = bool(merged.get("use_ssl", True))
    return merged


async def get_brevo_sms_config(db) -> dict:
    """Return effective Brevo SMS config. DB > env fallback."""
    db_val = await _fetch(db, "brevo_sms")
    env_val = {
        "api_key": os.environ.get("BREVO_API_KEY", ""),
        "sender": os.environ.get("BREVO_SMS_SENDER", "CINEMARIES"),
    }
    if not db_val:
        return env_val
    return {**env_val, **db_val}


def _invalidate(key: str):
    _CACHE.pop(key, None)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SmtpConfigBody(BaseModel):
    host: str = Field(min_length=1, max_length=200)
    port: int = Field(ge=1, le=65535, default=465)
    user: str = Field(min_length=1, max_length=200)
    password: Optional[str] = None  # if omitted, keep existing
    from_email: str = Field(min_length=3, max_length=200)
    from_name: str = Field(min_length=1, max_length=100, default="CINÉMARIÉS")
    use_ssl: bool = True


class SmtpTestBody(BaseModel):
    to: EmailStr


class BrevoSmsConfigBody(BaseModel):
    api_key: Optional[str] = None  # if omitted, keep existing
    sender: str = Field(min_length=1, max_length=11)


class BrevoSmsTestBody(BaseModel):
    to: str
    message: Optional[str] = "Test CINEMARIES depuis l'admin."


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def register_settings_routes(api_router: APIRouter, db, require_admin, send_email_fn=None, send_sms_fn=None):
    """Attach settings routes to api_router.

    send_email_fn: async(to, subject, html) → bool  (existing mailer.send_email)
    send_sms_fn:   async(to_e164, content, tag) → (ok, info)  (project_tracking.send_brevo_sms)
    """

    def _smtp_to_public(cfg: dict) -> dict:
        return {
            "host": cfg.get("host", ""),
            "port": cfg.get("port", 465),
            "user": cfg.get("user", ""),
            "password_mask": _mask_password(cfg.get("password", "")),
            "password_set": bool(cfg.get("password")),
            "from_email": cfg.get("from_email", ""),
            "from_name": cfg.get("from_name", ""),
            "use_ssl": bool(cfg.get("use_ssl", True)),
        }

    def _brevo_to_public(cfg: dict) -> dict:
        api_key = cfg.get("api_key", "") or ""
        return {
            "sender": cfg.get("sender", "CINEMARIES"),
            "api_key_mask": _mask_password(api_key),
            "api_key_set": bool(api_key),
        }

    # ---------- SMTP ----------
    @api_router.get("/admin/settings/smtp")
    async def get_smtp(admin: dict = Depends(require_admin)):
        cfg = await get_smtp_config(db)
        return _smtp_to_public(cfg)

    @api_router.put("/admin/settings/smtp")
    async def put_smtp(body: SmtpConfigBody, admin: dict = Depends(require_admin)):
        current = await get_smtp_config(db)
        value = {
            "host": body.host.strip(),
            "port": body.port,
            "user": body.user.strip(),
            "from_email": body.from_email.strip(),
            "from_name": body.from_name.strip(),
            "use_ssl": bool(body.use_ssl),
        }
        # Password: keep existing if omitted or empty
        new_pwd = (body.password or "").strip()
        if new_pwd:
            value["password"] = new_pwd
        elif current.get("password"):
            value["password"] = current["password"]
        else:
            raise HTTPException(400, "Mot de passe requis lors de la première configuration")

        await db.app_settings.update_one(
            {"key": "smtp"},
            {"$set": {"value": value, "updated_at": _utcnow(), "updated_by": admin.get("id")}},
            upsert=True,
        )
        _invalidate("smtp")
        new_cfg = await get_smtp_config(db)
        return _smtp_to_public(new_cfg)

    @api_router.post("/admin/settings/smtp/test")
    async def test_smtp(body: SmtpTestBody, admin: dict = Depends(require_admin)):
        # Force cache refresh so the just-saved config is used
        _invalidate("smtp")
        cfg = await get_smtp_config(db)
        if not (cfg.get("host") and cfg.get("user") and cfg.get("password") and cfg.get("from_email")):
            raise HTTPException(400, "Configuration SMTP incomplète")
        if send_email_fn is None:
            raise HTTPException(503, "Mailer non disponible")
        try:
            ok = await send_email_fn(
                str(body.to),
                "CINÉMARIÉS — Test SMTP",
                "<p><strong>Test SMTP réussi ✅</strong></p>"
                "<p>Cet email a été envoyé depuis le panneau admin CINÉMARIÉS pour "
                "valider la configuration SMTP.</p>"
                f"<p style='color:#888;font-size:12px'>Serveur : {cfg.get('host')}:{cfg.get('port')}<br>"
                f"Expéditeur : {cfg.get('from_email')}</p>",
            )
        except Exception as e:
            log.warning("[settings/smtp/test] exception: %s", e)
            return {"ok": False, "error": str(e)}
        return {"ok": bool(ok)}

    # ---------- Brevo SMS ----------
    @api_router.get("/admin/settings/brevo-sms")
    async def get_brevo(admin: dict = Depends(require_admin)):
        cfg = await get_brevo_sms_config(db)
        return _brevo_to_public(cfg)

    @api_router.put("/admin/settings/brevo-sms")
    async def put_brevo(body: BrevoSmsConfigBody, admin: dict = Depends(require_admin)):
        current = await get_brevo_sms_config(db)
        value = {"sender": body.sender.strip()}
        new_key = (body.api_key or "").strip()
        if new_key:
            value["api_key"] = new_key
        elif current.get("api_key"):
            value["api_key"] = current["api_key"]
        else:
            raise HTTPException(400, "Clé API requise lors de la première configuration")
        await db.app_settings.update_one(
            {"key": "brevo_sms"},
            {"$set": {"value": value, "updated_at": _utcnow(), "updated_by": admin.get("id")}},
            upsert=True,
        )
        _invalidate("brevo_sms")
        new_cfg = await get_brevo_sms_config(db)
        return _brevo_to_public(new_cfg)

    @api_router.post("/admin/settings/brevo-sms/test")
    async def test_brevo(body: BrevoSmsTestBody, admin: dict = Depends(require_admin)):
        if send_sms_fn is None:
            raise HTTPException(503, "SMS provider non disponible")
        _invalidate("brevo_sms")
        # normalize FR phone
        from project_tracking import normalize_fr_phone
        e164 = normalize_fr_phone(body.to)
        if not e164:
            raise HTTPException(400, "Numéro FR invalide (06XXXXXXXX ou +336XXXXXXXX)")
        ok, info = await send_sms_fn(e164, body.message or "Test CINEMARIES", "admin_test")
        return {"ok": ok, "info": info, "to_e164": e164}

    log.info("[app_settings] routes registered")
