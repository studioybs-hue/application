"""
Backend tests for RGPD endpoints:
- GET /api/me/export
- DELETE /api/me

Tests against the public backend URL from /app/frontend/.env (EXPO_PUBLIC_BACKEND_URL).
"""
import os
import sys
import uuid
import time
import requests
from pymongo import MongoClient

BACKEND_URL = "https://mariagevideo.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"

# Direct DB access for cascade verification
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wedding_stream"

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def step(msg: str):
    print(f"\n=== {msg} ===")


def fail(msg: str):
    print(f"  ❌ FAIL: {msg}")
    return False


def ok(msg: str):
    print(f"  ✅ {msg}")
    return True


results = []


def assert_eq(actual, expected, label: str):
    if actual == expected:
        ok(f"{label} == {expected!r}")
        results.append((label, True, None))
    else:
        fail(f"{label} expected {expected!r}, got {actual!r}")
        results.append((label, False, f"expected {expected!r}, got {actual!r}"))


def assert_true(cond: bool, label: str, detail: str = ""):
    if cond:
        ok(label)
        results.append((label, True, None))
    else:
        fail(f"{label} -- {detail}")
        results.append((label, False, detail))


def login(email: str, password: str) -> str | None:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        print(f"  login {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json()["access_token"]


def register(email: str, password: str, full_name: str) -> str | None:
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "full_name": full_name},
        timeout=30,
    )
    if r.status_code != 200:
        print(f"  register {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json()["access_token"]


def main() -> int:
    # ---- ADMIN LOGIN
    step("Login admin")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        fail("Could not login as admin")
        return 1
    ok(f"admin_token acquired ({admin_token[:12]}…)")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Get admin id
    r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=30)
    assert_eq(r.status_code, 200, "GET /auth/me (admin)")
    admin_user = r.json()
    admin_id = admin_user.get("id")
    assert_true(bool(admin_id), "admin has id")

    # ---- REGISTER fresh test user
    step("Register fresh test user")
    unique = uuid.uuid4().hex[:8]
    test_email = f"rgpd_user_{unique}@example.com"
    test_password = "Rgpd1234!"
    test_full_name = f"Test RGPD {unique}"
    user_token = register(test_email, test_password, test_full_name)
    if not user_token:
        fail("register failed")
        return 1
    ok(f"user registered: {test_email}")
    user_headers = {"Authorization": f"Bearer {user_token}"}

    r = requests.get(f"{API}/auth/me", headers=user_headers, timeout=30)
    assert_eq(r.status_code, 200, "GET /auth/me (test user)")
    test_user = r.json()
    test_user_id = test_user.get("id")

    # ---- GET /api/me/export
    step("GET /api/me/export — no token → expect 401")
    r = requests.get(f"{API}/me/export", timeout=30)
    assert_true(r.status_code in (401, 403), "GET /me/export without token returns 401/403",
                f"got {r.status_code} {r.text[:120]}")

    step("GET /api/me/export — with user token → expect 200")
    r = requests.get(f"{API}/me/export", headers=user_headers, timeout=30)
    assert_eq(r.status_code, 200, "GET /me/export with token → 200")
    if r.status_code == 200:
        export = r.json()
        # exported_at ISO format
        exported_at = export.get("exported_at")
        assert_true(isinstance(exported_at, str) and "T" in exported_at,
                    "exported_at is ISO string", f"value={exported_at!r}")
        assert_eq(export.get("exported_for"), test_email, "exported_for == user email")
        assert_true(isinstance(export.get("legal_basis"), str) and "RGPD" in export["legal_basis"],
                    "legal_basis mentions RGPD", f"value={export.get('legal_basis')!r}")
        data = export.get("data") or {}
        for k in ("account", "video_unlocks", "codes_created", "hosting_requests",
                  "payment_sessions", "contact_requests"):
            assert_true(k in data, f"data.{k} present")

        # password_hash not exposed
        account = data.get("account") or {}
        assert_true("password_hash" not in account,
                    "data.account does NOT contain password_hash",
                    f"keys={list(account.keys())}")
        # also recursively check whole payload
        import json as _json
        whole = _json.dumps(export)
        assert_true("password_hash" not in whole,
                    "password_hash absent from full export JSON")
        # account contains email & id
        assert_eq(account.get("email"), test_email, "data.account.email")
        assert_eq(account.get("id"), test_user_id, "data.account.id")
        # the lists must be arrays
        for k in ("video_unlocks", "codes_created", "hosting_requests",
                  "payment_sessions", "contact_requests"):
            assert_true(isinstance(data.get(k), list), f"data.{k} is list")

    # ---- DELETE /api/me — no token
    step("DELETE /api/me — no token → expect 401")
    r = requests.delete(f"{API}/me", timeout=30)
    assert_true(r.status_code in (401, 403), "DELETE /me without token returns 401/403",
                f"got {r.status_code} {r.text[:120]}")

    # ---- DELETE /api/me — last admin protection
    step("DELETE /api/me — as last admin → expect 400 (admin NOT deleted)")
    admin_count_before = db.users.count_documents({"is_admin": True})
    print(f"  admin_count before = {admin_count_before}")
    r = requests.delete(f"{API}/me", headers=admin_headers, timeout=30)
    assert_eq(r.status_code, 400, "DELETE /me (admin, last) → 400")
    if r.status_code == 400:
        detail = r.json().get("detail", "")
        assert_true("admin" in detail.lower() or "supprimer" in detail.lower(),
                    "400 detail mentions admin/suppression",
                    f"detail={detail!r}")
    # Make sure admin still exists
    admin_count_after = db.users.count_documents({"is_admin": True})
    assert_eq(admin_count_after, admin_count_before, "admin count unchanged after attempted delete")
    admin_doc = db.users.find_one({"email": ADMIN_EMAIL})
    assert_true(admin_doc is not None, "admin@wedding.fr still exists in DB")

    # ---- Prepare cascade fixtures for test user
    step("Create cascade fixtures for test user")

    # Assign wedding so user can create codes
    r = requests.post(
        f"{API}/admin/users/{test_user_id}/assign-wedding",
        headers=admin_headers,
        json={"client_id": "hanifa-et-dali"},
        timeout=30,
    )
    print(f"  assign-wedding → {r.status_code} {r.text[:200]}")
    # Mark as subscribed via DB so user can generate codes
    db.users.update_one({"id": test_user_id}, {"$set": {"is_subscribed": True, "subscription_tier": "basic"}})
    ok("user marked subscribed=true / tier=basic (DB)")

    # POST /client/codes — generate a code (created_by = test_user_id)
    r = requests.post(f"{API}/client/codes", headers=user_headers,
                      json={"label": "RGPD test code"}, timeout=30)
    print(f"  POST /client/codes → {r.status_code} {r.text[:200]}")
    created_code = None
    if r.status_code == 200:
        created_code = r.json().get("code")
        ok(f"generated unlock code {created_code} (unused)")

    # Generate another code and have user UNLOCK with it so user_unlocks gets a row
    # (and code becomes used_count > 0 so anonymization branch is hit)
    r = requests.post(f"{API}/client/codes", headers=user_headers,
                      json={"label": "RGPD used code"}, timeout=30)
    used_code = None
    if r.status_code == 200:
        used_code = r.json().get("code")
        # unlock with this code
        r2 = requests.post(
            f"{API}/weddings/unlock",
            headers=user_headers,
            json={"code": used_code, "device_id": f"RGPD_DEV_{unique}", "device_label": "rgpd-tester"},
            timeout=30,
        )
        print(f"  POST /weddings/unlock {used_code} → {r2.status_code} {r2.text[:120]}")
        if r2.status_code == 200:
            ok(f"user_unlock row created via code {used_code} (used)")

    # Submit a hosting request as the user (the endpoint may be public so it stores user_id if auth header present)
    r = requests.post(
        f"{API}/hosting/requests",
        headers=user_headers,
        json={
            "name": test_full_name,
            "email": test_email,
            "phone": "+33600000000",
            "wedding_date": "2026-06-15",
            "location": "Paris",
            "guests": 100,
            "message": "RGPD cascade test - hosting request",
        },
        timeout=30,
    )
    print(f"  POST /hosting/requests → {r.status_code} {r.text[:120]}")

    # Submit a contact request with user's email
    r = requests.post(
        f"{API}/contact",
        json={
            "name": test_full_name,
            "email": test_email,
            "message": "RGPD cascade test - contact request",
            "source": "rgpd-test",
        },
        timeout=30,
    )
    print(f"  POST /contact → {r.status_code} {r.text[:120]}")

    # Try billing checkout to create a checkout_sessions record (may fail if Stripe; tolerate)
    r = requests.post(f"{API}/billing/checkout", headers=user_headers,
                      json={"tier": "basic"}, timeout=30)
    print(f"  POST /billing/checkout → {r.status_code} {r.text[:120]}")

    # Capture pre-delete counts in DB
    pre_unlocks = db.user_unlocks.count_documents({"user_id": test_user_id})
    pre_codes_created = db.unlock_codes.count_documents({"created_by": test_user_id})
    pre_codes_used = db.unlock_codes.count_documents({"created_by": test_user_id, "used_count": {"$gt": 0}})
    pre_codes_unused = db.unlock_codes.count_documents({"created_by": test_user_id, "used_count": 0})
    pre_hosting = db.hosting_requests.count_documents({"user_id": test_user_id})
    pre_checkouts = db.checkout_sessions.count_documents({"user_id": test_user_id})
    pre_contacts = db.contact_requests.count_documents({"email": test_email})
    print(f"  pre counts: unlocks={pre_unlocks} codes_total={pre_codes_created} "
          f"(used={pre_codes_used}, unused={pre_codes_unused}) hosting={pre_hosting} "
          f"checkouts={pre_checkouts} contacts={pre_contacts}")
    assert_true(pre_codes_created >= 1, "at least 1 unlock_code created_by user", f"got {pre_codes_created}")
    assert_true(pre_contacts >= 1, "at least 1 contact_request matching user email", f"got {pre_contacts}")

    # ---- DELETE /api/me — non-admin user
    step("DELETE /api/me — as test user → expect 200")
    r = requests.delete(f"{API}/me", headers=user_headers, timeout=30)
    assert_eq(r.status_code, 200, "DELETE /me (non-admin) → 200")
    if r.status_code == 200:
        payload = r.json()
        assert_eq(payload.get("deleted"), True, "response.deleted == True")
        assert_eq(payload.get("email"), test_email, "response.email matches")

    # ---- Verify cascade
    step("Verify cascade")
    post_user = db.users.find_one({"id": test_user_id})
    assert_true(post_user is None, "user document removed from db.users")

    post_unlocks = db.user_unlocks.count_documents({"user_id": test_user_id})
    assert_eq(post_unlocks, 0, "user_unlocks cascaded (== 0)")

    post_hosting = db.hosting_requests.count_documents({"user_id": test_user_id})
    assert_eq(post_hosting, 0, "hosting_requests cascaded (== 0)")

    post_checkouts = db.checkout_sessions.count_documents({"user_id": test_user_id})
    assert_eq(post_checkouts, 0, "checkout_sessions cascaded (== 0)")

    post_contacts = db.contact_requests.count_documents({"email": test_email})
    assert_eq(post_contacts, 0, "contact_requests cascaded by email (== 0)")

    # Codes: unused codes deleted entirely
    still_by_uid = db.unlock_codes.count_documents({"created_by": test_user_id})
    assert_eq(still_by_uid, 0, "no unlock_codes still reference created_by=user_id")

    # Used codes should be anonymized → created_by='deleted_user'
    if used_code:
        rec = db.unlock_codes.find_one({"code": used_code})
        if pre_codes_used > 0:
            assert_true(rec is not None, "used code still exists in DB (preserved for stats)")
            if rec:
                assert_eq(rec.get("created_by"), "deleted_user",
                          f"used code {used_code} created_by anonymized")
        else:
            # If somehow unlock didn't bump used_count, the code may have been deleted.
            print(f"  NOTE: pre_codes_used was 0, anonymization branch not strictly verified for this run")

    # Unused code should be deleted
    if created_code:
        rec = db.unlock_codes.find_one({"code": created_code})
        # created_code was never used → deleted entirely (used_count==0 path)
        # Unless coincidentally that exact code was also unlocked, but it isn't
        if pre_codes_unused > 0:
            assert_true(rec is None, f"unused code {created_code} deleted (created_by=user_id, used_count=0)")

    # Verify user CANNOT login anymore
    step("Verify deleted user cannot login")
    r = requests.post(f"{API}/auth/login", json={"email": test_email, "password": test_password}, timeout=30)
    assert_true(r.status_code in (400, 401, 404),
                "deleted user login → 4xx", f"got {r.status_code} {r.text[:120]}")

    # ---- Summary
    step("Summary")
    total = len(results)
    failed = [r for r in results if not r[1]]
    print(f"  {total - len(failed)} / {total} assertions passed")
    for label, passed, detail in failed:
        print(f"   FAIL: {label} — {detail}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
