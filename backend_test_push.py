"""
Tests for the NEW push notification endpoints on CINÉMARIÉS backend.

Endpoints under test:
  POST   /api/notifications/register-token
  DELETE /api/notifications/token
  GET    /api/admin/videos/{video_id}/notify-recipients
  POST   /api/admin/videos/{video_id}/notify

Plus smoke checks on existing endpoints (auth, weddings/unlock, admin/users, admin/hosting).

Base URL is read from /app/frontend/.env (EXPO_PUBLIC_BACKEND_URL or EXPO_BACKEND_URL).
"""

from __future__ import annotations

import os
import sys
import time
import asyncio
import uuid
from pathlib import Path

import httpx
from motor.motor_asyncio import AsyncIOMotorClient


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
def _read_base_url() -> str:
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("EXPO_BACKEND_URL="):
                _, _, v = line.partition("=")
                return v.strip().strip('"').rstrip("/") + "/api"
    raise RuntimeError("Could not find EXPO_PUBLIC_BACKEND_URL in /app/frontend/.env")


BASE = _read_base_url()
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"
TEST_EMAIL = "test@wedding.fr"
TEST_PASS = "test1234"


# Mongo (for DB asserts on push_tokens and notification_log)
MONGO_URL = None
DB_NAME = None
backend_env = Path("/app/backend/.env")
if backend_env.exists():
    for line in backend_env.read_text().splitlines():
        line = line.strip()
        if line.startswith("MONGO_URL="):
            MONGO_URL = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            DB_NAME = line.split("=", 1)[1].strip().strip('"')

# Result tracking
RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, info: str = ""):
    icon = "✅" if ok else "❌"
    print(f"  {icon} {name}{(' — ' + info) if info else ''}")
    RESULTS.append((name, ok, info))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def login(client: httpx.Client, email: str, password: str) -> str:
    r = client.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    return r.json()["access_token"]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
async def main():
    print(f"[base] {BASE}")
    if not MONGO_URL or not DB_NAME:
        print("[warn] Could not read MONGO_URL/DB_NAME from /app/backend/.env — DB asserts will be skipped")
        db = None
    else:
        mongo = AsyncIOMotorClient(MONGO_URL)
        db = mongo[DB_NAME]

    client = httpx.Client(timeout=30)

    # ------------------------------------------------------------------
    # AUTH
    # ------------------------------------------------------------------
    print("\n=== AUTH ===")
    try:
        admin_token = login(client, ADMIN_EMAIL, ADMIN_PASS)
        record("Login admin@wedding.fr", True, "got token")
    except Exception as e:
        record("Login admin@wedding.fr", False, f"FATAL: {e}")
        return

    try:
        user_token = login(client, TEST_EMAIL, TEST_PASS)
        record("Login test@wedding.fr", True, "got token")
    except Exception as e:
        record("Login test@wedding.fr", False, f"FATAL: {e}")
        return

    # Get test user id (for DB asserts)
    me = client.get(f"{BASE}/auth/me", headers=auth_headers(user_token)).json()
    user_id = me["id"]
    print(f"[info] test user_id={user_id}")

    # Cleanup any stale push tokens for this test user before starting
    if db is not None:
        await db.push_tokens.delete_many({"user_id": user_id})

    # ------------------------------------------------------------------
    # 1) POST /api/notifications/register-token
    # ------------------------------------------------------------------
    print("\n=== 1) POST /api/notifications/register-token ===")

    # 1a) 401 without auth
    r = client.post(f"{BASE}/notifications/register-token", json={"expo_push_token": "ExponentPushToken[fake-x]"})
    record("No auth → 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    # 1b) 400 on invalid token format
    r = client.post(f"{BASE}/notifications/register-token",
                    headers=auth_headers(user_token),
                    json={"expo_push_token": "bogus_token_not_expo", "platform": "android"})
    record("Invalid token prefix → 400", r.status_code == 400, f"status={r.status_code} body={r.text[:120]}")

    # 1c) Empty token → 400
    r = client.post(f"{BASE}/notifications/register-token",
                    headers=auth_headers(user_token),
                    json={"expo_push_token": "", "platform": "android"})
    record("Empty token → 400", r.status_code == 400, f"status={r.status_code}")

    # 1d) Valid token registration
    fake_t1 = f"ExponentPushToken[fake-{uuid.uuid4().hex[:10]}]"
    r = client.post(f"{BASE}/notifications/register-token",
                    headers=auth_headers(user_token),
                    json={"expo_push_token": fake_t1, "platform": "android", "device_id": "device-A"})
    record("Register valid token (1st) → 200", r.status_code == 200 and r.json().get("ok") is True,
           f"status={r.status_code} body={r.text[:120]}")

    # 1e) Idempotent: register same token again → still 1 row in db
    time.sleep(0.5)
    r2 = client.post(f"{BASE}/notifications/register-token",
                     headers=auth_headers(user_token),
                     json={"expo_push_token": fake_t1, "platform": "android", "device_id": "device-A"})
    record("Re-register SAME token → 200", r2.status_code == 200, f"status={r2.status_code}")

    if db is not None:
        cnt_same = await db.push_tokens.count_documents({"user_id": user_id, "expo_push_token": fake_t1})
        record("Idempotency: exactly 1 doc in db.push_tokens for (user_id, token)",
               cnt_same == 1, f"actual count={cnt_same}")

        # Compare created_at vs last_seen_at on second insert — last_seen should be >= created_at
        doc = await db.push_tokens.find_one({"user_id": user_id, "expo_push_token": fake_t1})
        if doc and doc.get("created_at") and doc.get("last_seen_at"):
            ls = doc["last_seen_at"]
            cr = doc["created_at"]
            record("last_seen_at >= created_at", ls >= cr, f"created={cr} last_seen={ls}")
        else:
            record("doc has created_at + last_seen_at", False, str(doc))

    # 1f) Register a SECOND different token for the same user
    fake_t2 = f"ExpoPushToken[fake-{uuid.uuid4().hex[:10]}]"  # different prefix variant accepted
    r = client.post(f"{BASE}/notifications/register-token",
                    headers=auth_headers(user_token),
                    json={"expo_push_token": fake_t2, "platform": "ios", "device_id": "device-B"})
    record("Register valid 2nd token (ExpoPushToken prefix) → 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:120]}")

    if db is not None:
        cnt_total = await db.push_tokens.count_documents({"user_id": user_id})
        record("2 different tokens for same user → 2 docs", cnt_total == 2, f"count={cnt_total}")

    # ------------------------------------------------------------------
    # 2) DELETE /api/notifications/token
    # ------------------------------------------------------------------
    print("\n=== 2) DELETE /api/notifications/token ===")

    # 2a) Unauth
    r = client.delete(f"{BASE}/notifications/token?token={fake_t1}")
    record("DELETE no auth → 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    # 2b) Delete specific token only
    r = client.delete(f"{BASE}/notifications/token", params={"token": fake_t1}, headers=auth_headers(user_token))
    record("DELETE specific token → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:150]}")

    if db is not None:
        remaining = await db.push_tokens.count_documents({"user_id": user_id})
        record("After DELETE specific token → 1 remaining", remaining == 1, f"count={remaining}")
        cnt_t1 = await db.push_tokens.count_documents({"user_id": user_id, "expo_push_token": fake_t1})
        record("Specific token gone", cnt_t1 == 0, f"count={cnt_t1}")
        cnt_t2 = await db.push_tokens.count_documents({"user_id": user_id, "expo_push_token": fake_t2})
        record("Other token still there", cnt_t2 == 1, f"count={cnt_t2}")

    # 2c) DELETE without param → wipes all for user
    r = client.delete(f"{BASE}/notifications/token", headers=auth_headers(user_token))
    record("DELETE all (no param) → 200", r.status_code == 200, f"status={r.status_code}")

    if db is not None:
        remaining_all = await db.push_tokens.count_documents({"user_id": user_id})
        record("After DELETE all → 0 remaining", remaining_all == 0, f"count={remaining_all}")

    # ------------------------------------------------------------------
    # PREP: get a real video_id (hanifa-et-dali video) via /api/admin/videos
    # ------------------------------------------------------------------
    print("\n=== PREP: list admin videos ===")
    r = client.get(f"{BASE}/admin/videos", headers=auth_headers(admin_token))
    if r.status_code != 200:
        record("GET /api/admin/videos as admin → 200", False, f"status={r.status_code} body={r.text[:150]}")
        return
    videos = r.json().get("videos", [])
    record("GET /api/admin/videos as admin → 200", True, f"count={len(videos)}")

    # Choose a video for hanifa-et-dali (so the test user is its owner)
    target_video = None
    for v in videos:
        if v.get("client_id") == "hanifa-et-dali":
            target_video = v
            break
    if target_video is None and videos:
        target_video = videos[0]
    if not target_video:
        record("Found a video to test with", False, "no videos in DB")
        return
    video_id = target_video["id"]
    print(f"[info] Using video_id={video_id} (client_id={target_video.get('client_id')}, title={target_video.get('title')})")

    # ------------------------------------------------------------------
    # 3) GET /api/admin/videos/{video_id}/notify-recipients
    # ------------------------------------------------------------------
    print("\n=== 3) GET /api/admin/videos/{video_id}/notify-recipients ===")

    # 3a) Unauth → 401/403
    r = client.get(f"{BASE}/admin/videos/{video_id}/notify-recipients")
    record("Unauth → 401/403", r.status_code in (401, 403), f"status={r.status_code}")

    # 3b) Non-admin → 403
    r = client.get(f"{BASE}/admin/videos/{video_id}/notify-recipients", headers=auth_headers(user_token))
    record("Non-admin → 403", r.status_code == 403, f"status={r.status_code}")

    # 3c) Unknown video_id → 404
    r = client.get(f"{BASE}/admin/videos/nonexistent-id/notify-recipients", headers=auth_headers(admin_token))
    record("Unknown video_id → 404", r.status_code == 404, f"status={r.status_code}")

    # Re-register one fake token (for test user / owner of hanifa-et-dali)
    fake_t3 = f"ExponentPushToken[fake-{uuid.uuid4().hex[:10]}]"
    client.post(f"{BASE}/notifications/register-token",
                headers=auth_headers(user_token),
                json={"expo_push_token": fake_t3, "platform": "android", "device_id": "device-recip"})

    # 3d) include_guests=false → owners=N (>=0), guests=0
    r = client.get(f"{BASE}/admin/videos/{video_id}/notify-recipients",
                   params={"include_guests": "false"}, headers=auth_headers(admin_token))
    ok = r.status_code == 200
    body = r.json() if ok else {}
    expected_keys = {"video_title", "client_name", "client_id", "owners", "guests", "push_devices", "emails"}
    has_keys = expected_keys.issubset(set(body.keys()))
    record("Real video include_guests=false → 200 with all expected keys",
           ok and has_keys, f"status={r.status_code} keys={sorted(body.keys())}")
    record("include_guests=false → guests == 0", ok and body.get("guests") == 0,
           f"guests={body.get('guests')}")
    # For hanifa-et-dali, push_devices should be >= 1 (we just registered fake_t3) and owners >= 1
    if target_video.get("client_id") == "hanifa-et-dali":
        record("hanifa-et-dali owners >= 1", ok and body.get("owners", 0) >= 1, f"owners={body.get('owners')}")
        record("push_devices >= 1 (after register)", ok and body.get("push_devices", 0) >= 1,
               f"push_devices={body.get('push_devices')}")

    # 3e) include_guests=true → must include guests if user_unlocks docs exist for this wedding
    # Add a synthetic guest unlock so guests > 0 (we'll add then clean up)
    fake_guest_user = {"id": f"guest_test_{uuid.uuid4().hex[:6]}", "email": f"guest_{uuid.uuid4().hex[:6]}@example.com", "is_admin": False}
    fake_guest_unlock = {"user_id": fake_guest_user["id"], "client_id": target_video.get("client_id") or "hanifa-et-dali"}
    if db is not None:
        await db.users.insert_one(fake_guest_user)
        await db.user_unlocks.insert_one({**fake_guest_unlock, "id": str(uuid.uuid4())})

    r = client.get(f"{BASE}/admin/videos/{video_id}/notify-recipients",
                   params={"include_guests": "true"}, headers=auth_headers(admin_token))
    body2 = r.json() if r.status_code == 200 else {}
    record("Real video include_guests=true → 200", r.status_code == 200,
           f"status={r.status_code} guests={body2.get('guests')}")
    record("include_guests=true → guests >= 1 (synthetic)", body2.get("guests", 0) >= 1,
           f"guests={body2.get('guests')}")

    # ------------------------------------------------------------------
    # 4) POST /api/admin/videos/{video_id}/notify
    # ------------------------------------------------------------------
    print("\n=== 4) POST /api/admin/videos/{video_id}/notify ===")

    # 4a) Non-admin → 403
    r = client.post(f"{BASE}/admin/videos/{video_id}/notify",
                    headers=auth_headers(user_token),
                    json={"title": "X", "message": "Y"})
    record("Non-admin → 403", r.status_code == 403, f"status={r.status_code}")

    # 4b) Unknown video_id → 404
    r = client.post(f"{BASE}/admin/videos/nonexistent-id/notify",
                    headers=auth_headers(admin_token),
                    json={"title": "X", "message": "Y"})
    record("Unknown video_id → 404", r.status_code == 404, f"status={r.status_code}")

    # 4c) Happy path — send_email=false, send_push=true with fake tokens
    payload = {
        "title": "Test push CINÉMARIÉS",
        "message": "Hello — votre film est en ligne !",
        "include_guests": False,
        "send_push": True,
        "send_email": False,
    }
    r = client.post(f"{BASE}/admin/videos/{video_id}/notify",
                    headers=auth_headers(admin_token), json=payload, timeout=60)
    ok = r.status_code == 200
    body = r.json() if ok else {}
    record("Happy path send_email=false → 200", ok, f"status={r.status_code} body={r.text[:250]}")
    if ok:
        record("Response shape has 'ok','push','email','recipients'",
               all(k in body for k in ("ok", "push", "email", "recipients")),
               f"keys={list(body.keys())}")
        # push.failed > 0 since tokens are fake (Expo rejects). DO NOT fail if push.sent==0.
        push = body.get("push") or {}
        # graceful degradation check: not a 5xx and shape correct
        record("push has sent/failed/errors keys", all(k in push for k in ("sent", "failed", "errors")),
               f"push={push}")
        email = body.get("email") or {}
        record("send_email=false → email.sent==0 and email.failed==0",
               email.get("sent", -1) == 0 and email.get("failed", -1) == 0,
               f"email={email}")
        recipients = body.get("recipients") or {}
        record("recipients has owners/guests/push_devices/emails",
               all(k in recipients for k in ("owners", "guests", "push_devices", "emails")),
               f"recipients={recipients}")
        print(f"  [info] push={push} email={email} recipients={recipients}")

    # 4d) Verify a row added to db.notification_log
    if db is not None:
        await asyncio.sleep(0.5)
        latest = await db.notification_log.find_one({"video_id": video_id}, sort=[("created_at", -1)])
        if latest:
            ok = (
                latest.get("title") == payload["title"]
                and latest.get("message") == payload["message"]
                and latest.get("include_guests") == payload["include_guests"]
                and "push_result" in latest
                and "email_result" in latest
                and "id" in latest
                and "client_id" in latest
                and "created_at" in latest
            )
            record("notification_log row inserted with all expected fields", ok, f"doc keys={sorted(latest.keys())}")
        else:
            record("notification_log row inserted", False, "no doc found")

    # ------------------------------------------------------------------
    # CLEANUP synthetic guest
    # ------------------------------------------------------------------
    if db is not None:
        await db.users.delete_one({"id": fake_guest_user["id"]})
        await db.user_unlocks.delete_one(fake_guest_unlock | {})
        await db.user_unlocks.delete_many({"user_id": fake_guest_user["id"]})
        # also wipe any tokens we registered during this test
        await db.push_tokens.delete_many({"user_id": user_id})

    # ------------------------------------------------------------------
    # 5) Smoke / regression checks
    # ------------------------------------------------------------------
    print("\n=== 5) Smoke / regression ===")

    # Auth me
    r = client.get(f"{BASE}/auth/me", headers=auth_headers(user_token))
    record("Smoke: GET /api/auth/me → 200", r.status_code == 200, f"status={r.status_code}")

    # weddings/public + unlock with active code S9A5URZC
    r = client.get(f"{BASE}/weddings/public")
    record("Smoke: GET /api/weddings/public → 200", r.status_code == 200, f"status={r.status_code}")

    r = client.post(f"{BASE}/weddings/unlock", json={"code": "S9A5URZC", "device_id": "PUSH_TEST_LEGACY"})
    record("Smoke: POST /api/weddings/unlock (S9A5URZC) → 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:150]}")

    # admin/users
    r = client.get(f"{BASE}/admin/users", headers=auth_headers(admin_token))
    record("Smoke: GET /api/admin/users (admin) → 200", r.status_code == 200, f"status={r.status_code}")

    # admin/hosting (hosting_requests admin endpoint)
    r = client.get(f"{BASE}/admin/hosting", headers=auth_headers(admin_token))
    record("Smoke: GET /api/admin/hosting (admin) → 200/404",
           r.status_code in (200, 404), f"status={r.status_code}")

    # ------------------------------------------------------------------
    # SUMMARY
    # ------------------------------------------------------------------
    print("\n=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    fails = [(n, info) for (n, ok, info) in RESULTS if not ok]
    print(f"Passed: {passed}/{total}")
    if fails:
        print("FAILED:")
        for n, info in fails:
            print(f"  - {n} :: {info}")
    return passed == total


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
