"""
Backend tests for RGPD endpoints (RETEST after cascade fix):
- GET /api/me/export  (must now include codes_created via owner_user_id)
- DELETE /api/me      (must now cascade unlock_codes via owner_user_id + anonymize device fingerprints)

Tests against the public backend URL.
"""
import sys
import uuid
import json as _json
import requests
from pymongo import MongoClient

BACKEND_URL = "https://mariagevideo.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wedding_stream"

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def step(msg: str):
    print(f"\n=== {msg} ===")


def fail(msg: str):
    print(f"  FAIL: {msg}")
    return False


def ok(msg: str):
    print(f"  OK : {msg}")
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


def login(email: str, password: str):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        print(f"  login {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json()["access_token"]


def register(email: str, password: str, full_name: str):
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "full_name": full_name},
                      timeout=30)
    if r.status_code != 200:
        print(f"  register {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json()["access_token"]


def main() -> int:
    # =========================================================
    # PART A — Set up admin + a fresh user
    # =========================================================
    step("Login admin")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        return fail("Could not login as admin") or 1
    ok(f"admin_token acquired ({admin_token[:12]}...)")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=30)
    assert_eq(r.status_code, 200, "GET /auth/me (admin)")
    admin_user = r.json()
    assert_true(bool(admin_user.get("id")), "admin has id")

    step("Register fresh test user")
    unique = uuid.uuid4().hex[:8]
    test_email = f"rgpd_user_{unique}@example.com"
    test_password = "Rgpd1234!"
    test_full_name = f"Test RGPD {unique}"
    user_token = register(test_email, test_password, test_full_name)
    if not user_token:
        return fail("register failed") or 1
    ok(f"user registered: {test_email}")
    user_headers = {"Authorization": f"Bearer {user_token}"}

    r = requests.get(f"{API}/auth/me", headers=user_headers, timeout=30)
    assert_eq(r.status_code, 200, "GET /auth/me (test user)")
    test_user = r.json()
    test_user_id = test_user.get("id")

    # =========================================================
    # PART B — Setup wedding + subscription so user can create codes
    # =========================================================
    step("Admin assigns wedding to test user + mark subscribed")
    r = requests.post(f"{API}/admin/users/{test_user_id}/assign-wedding",
                      headers=admin_headers,
                      json={"client_id": "hanifa-et-dali"}, timeout=30)
    print(f"  assign-wedding -> {r.status_code} {r.text[:200]}")
    assert_true(r.status_code == 200, "admin assigned wedding to test user", f"got {r.status_code}")
    db.users.update_one({"id": test_user_id},
                        {"$set": {"is_subscribed": True, "subscription_tier": "basic"}})
    ok("user marked subscribed=true / tier=basic (DB)")

    # Create 2 codes
    step("Create 2 codes (one will be left unused, one will be unlocked/used)")
    r = requests.post(f"{API}/client/codes", headers=user_headers,
                      json={"label": "RGPD unused code"}, timeout=30)
    assert_eq(r.status_code, 200, "POST /client/codes #1 -> 200")
    unused_code = r.json().get("code") if r.status_code == 200 else None
    print(f"  unused_code = {unused_code}")

    r = requests.post(f"{API}/client/codes", headers=user_headers,
                      json={"label": "RGPD used code"}, timeout=30)
    assert_eq(r.status_code, 200, "POST /client/codes #2 -> 200")
    used_code = r.json().get("code") if r.status_code == 200 else None
    print(f"  used_code   = {used_code}")

    # Bind one code to a device by unlocking
    device_id = f"RGPD_DEV_{unique}"
    device_label = f"rgpd-tester-{unique}"
    r = requests.post(f"{API}/weddings/unlock", headers=user_headers,
                      json={"code": used_code, "device_id": device_id,
                            "device_label": device_label}, timeout=30)
    print(f"  POST /weddings/unlock {used_code} -> {r.status_code} {r.text[:140]}")
    assert_eq(r.status_code, 200, "unlock used_code -> 200")

    # Verify the code has owner_user_id=test_user_id pre-delete
    pre_used_rec = db.unlock_codes.find_one({"code": used_code}) if used_code else None
    pre_unused_rec = db.unlock_codes.find_one({"code": unused_code}) if unused_code else None
    assert_true(pre_used_rec is not None and pre_used_rec.get("owner_user_id") == test_user_id,
                "used code stored with owner_user_id=test_user_id",
                f"rec={pre_used_rec}")
    assert_true(pre_unused_rec is not None and pre_unused_rec.get("owner_user_id") == test_user_id,
                "unused code stored with owner_user_id=test_user_id",
                f"rec={pre_unused_rec}")
    if pre_used_rec:
        assert_true(pre_used_rec.get("current_uses", 0) >= 1,
                    "used code has current_uses >= 1",
                    f"current_uses={pre_used_rec.get('current_uses')}")
        assert_true(bool(pre_used_rec.get("bound_device_ip")) or bool(pre_used_rec.get("bound_device_ua")),
                    "used code has bound_device_ip or bound_device_ua before delete",
                    f"ip={pre_used_rec.get('bound_device_ip')} ua={pre_used_rec.get('bound_device_ua')}")

    # =========================================================
    # PART C — GET /api/me/export — codes_created must be non-empty
    # =========================================================
    step("GET /api/me/export — no token -> 401")
    r = requests.get(f"{API}/me/export", timeout=30)
    assert_true(r.status_code in (401, 403),
                "GET /me/export without token -> 401/403", f"got {r.status_code}")

    step("GET /api/me/export — with user token -> 200, codes_created non-empty")
    r = requests.get(f"{API}/me/export", headers=user_headers, timeout=30)
    assert_eq(r.status_code, 200, "GET /me/export -> 200")
    if r.status_code == 200:
        export = r.json()
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

        # password_hash safety
        account = data.get("account") or {}
        assert_true("password_hash" not in account,
                    "data.account does NOT contain password_hash",
                    f"keys={list(account.keys())}")
        whole = _json.dumps(export)
        assert_true("password_hash" not in whole,
                    "password_hash absent from full export JSON")
        assert_eq(account.get("email"), test_email, "data.account.email")
        assert_eq(account.get("id"), test_user_id, "data.account.id")

        # NEW: codes_created must be a non-empty list containing the 2 codes we made
        codes_created = data.get("codes_created") or []
        assert_true(isinstance(codes_created, list) and len(codes_created) >= 2,
                    "data.codes_created is non-empty (>= 2 codes)",
                    f"len={len(codes_created) if isinstance(codes_created, list) else 'N/A'}")
        code_values = [c.get("code") for c in codes_created if isinstance(c, dict)]
        assert_true(unused_code in code_values,
                    f"data.codes_created contains unused_code {unused_code}",
                    f"codes={code_values}")
        assert_true(used_code in code_values,
                    f"data.codes_created contains used_code {used_code}",
                    f"codes={code_values}")
        # at least one item should expose owner_user_id == user id
        owners = {c.get("owner_user_id") for c in codes_created if isinstance(c, dict)}
        assert_true(test_user_id in owners,
                    "exported codes have owner_user_id == test user id",
                    f"owners={owners}")

    # =========================================================
    # PART D — DELETE /api/me sanity: 401 unauth + last admin protection
    # =========================================================
    step("DELETE /api/me — no token -> 401")
    r = requests.delete(f"{API}/me", timeout=30)
    assert_true(r.status_code in (401, 403),
                "DELETE /me without token -> 401/403",
                f"got {r.status_code} {r.text[:120]}")

    step("DELETE /api/me — as last admin -> 400")
    admin_count_before = db.users.count_documents({"is_admin": True})
    print(f"  admin_count before = {admin_count_before}")
    r = requests.delete(f"{API}/me", headers=admin_headers, timeout=30)
    assert_eq(r.status_code, 400, "DELETE /me (admin, last) -> 400")
    if r.status_code == 400:
        detail = r.json().get("detail", "")
        assert_true("admin" in detail.lower() or "supprimer" in detail.lower(),
                    "400 detail mentions admin/suppression", f"detail={detail!r}")
    admin_count_after = db.users.count_documents({"is_admin": True})
    assert_eq(admin_count_after, admin_count_before, "admin count unchanged after attempted delete")
    assert_true(db.users.find_one({"email": ADMIN_EMAIL}) is not None,
                "admin@wedding.fr still exists in DB")

    # =========================================================
    # PART E — Add other cascade-eligible records
    # =========================================================
    step("Create hosting + contact records for cascade")
    r = requests.post(f"{API}/hosting/requests", headers=user_headers,
                      json={"name": test_full_name, "email": test_email,
                            "phone": "+33600000000", "wedding_date": "2026-06-15",
                            "location": "Paris", "guests": 100,
                            "message": "RGPD cascade test - hosting"},
                      timeout=30)
    print(f"  POST /hosting/requests -> {r.status_code} {r.text[:120]}")

    r = requests.post(f"{API}/contact",
                      json={"name": test_full_name, "email": test_email,
                            "message": "RGPD cascade test - contact", "source": "rgpd-test"},
                      timeout=30)
    print(f"  POST /contact -> {r.status_code} {r.text[:120]}")

    r = requests.post(f"{API}/billing/checkout", headers=user_headers,
                      json={"tier": "basic"}, timeout=30)
    print(f"  POST /billing/checkout -> {r.status_code} {r.text[:120]}")

    # Pre-delete counts using NEW field names
    pre_unlocks = db.user_unlocks.count_documents({"user_id": test_user_id})
    pre_codes_total = db.unlock_codes.count_documents({"owner_user_id": test_user_id})
    pre_codes_used = db.unlock_codes.count_documents({"owner_user_id": test_user_id,
                                                      "current_uses": {"$gt": 0}})
    pre_codes_unused = db.unlock_codes.count_documents({"owner_user_id": test_user_id,
                                                        "current_uses": 0})
    pre_hosting = db.hosting_requests.count_documents({"user_id": test_user_id})
    pre_checkouts = db.checkout_sessions.count_documents({"user_id": test_user_id})
    pre_contacts = db.contact_requests.count_documents({"email": test_email})
    print(f"  pre counts: unlocks={pre_unlocks} codes_total={pre_codes_total} "
          f"(used={pre_codes_used}, unused={pre_codes_unused}) "
          f"hosting={pre_hosting} checkouts={pre_checkouts} contacts={pre_contacts}")
    assert_true(pre_codes_total >= 2, "user owns >=2 unlock_codes pre-delete",
                f"got {pre_codes_total}")
    assert_true(pre_codes_used >= 1, "user has >=1 used code pre-delete",
                f"got {pre_codes_used}")
    assert_true(pre_codes_unused >= 1, "user has >=1 unused code pre-delete",
                f"got {pre_codes_unused}")
    assert_true(pre_contacts >= 1, "user has >=1 contact_request pre-delete",
                f"got {pre_contacts}")

    # =========================================================
    # PART F — DELETE /api/me (non-admin) -> verify cascade + anonymization
    # =========================================================
    step("DELETE /api/me — as test user -> 200")
    r = requests.delete(f"{API}/me", headers=user_headers, timeout=30)
    assert_eq(r.status_code, 200, "DELETE /me (non-admin) -> 200")
    if r.status_code == 200:
        payload = r.json()
        assert_eq(payload.get("deleted"), True, "response.deleted == True")
        assert_eq(payload.get("email"), test_email, "response.email matches")

    step("Verify cascade post-delete")
    assert_true(db.users.find_one({"id": test_user_id}) is None,
                "user document removed from db.users")
    assert_eq(db.user_unlocks.count_documents({"user_id": test_user_id}), 0,
              "user_unlocks cascaded (== 0)")
    assert_eq(db.hosting_requests.count_documents({"user_id": test_user_id}), 0,
              "hosting_requests cascaded (== 0)")
    assert_eq(db.checkout_sessions.count_documents({"user_id": test_user_id}), 0,
              "checkout_sessions cascaded (== 0)")
    assert_eq(db.contact_requests.count_documents({"email": test_email}), 0,
              "contact_requests cascaded by email (== 0)")

    # unlock_codes cascade — KEY FIX VERIFICATION
    still_by_uid = db.unlock_codes.count_documents({"owner_user_id": test_user_id})
    assert_eq(still_by_uid, 0,
              "no unlock_codes still reference owner_user_id=<user id> (FIX VERIFIED)")

    # unused code should be deleted
    if unused_code:
        rec = db.unlock_codes.find_one({"code": unused_code})
        assert_true(rec is None,
                    f"unused code {unused_code} deleted (current_uses=0)",
                    f"rec={rec}")

    # used code should be anonymized, NOT deleted
    if used_code:
        rec = db.unlock_codes.find_one({"code": used_code})
        assert_true(rec is not None, f"used code {used_code} preserved (stats)")
        if rec:
            assert_eq(rec.get("owner_user_id"), "deleted_user",
                      f"used code {used_code} owner_user_id anonymized")
            assert_true(rec.get("owner_email") is None,
                        f"used code {used_code} owner_email is None",
                        f"value={rec.get('owner_email')!r}")
            assert_true(rec.get("bound_device_ip") is None,
                        f"used code {used_code} bound_device_ip is None",
                        f"value={rec.get('bound_device_ip')!r}")
            assert_true(rec.get("bound_device_ua") is None,
                        f"used code {used_code} bound_device_ua is None",
                        f"value={rec.get('bound_device_ua')!r}")
            assert_true(rec.get("bound_device_label") is None,
                        f"used code {used_code} bound_device_label is None",
                        f"value={rec.get('bound_device_label')!r}")

    # Sanity: no remaining PII for that user email in unlock_codes
    leaked = db.unlock_codes.count_documents({"owner_email": test_email})
    assert_eq(leaked, 0, "no unlock_codes still leak owner_email==<deleted user email>")

    # User cannot login anymore
    step("Verify deleted user cannot login")
    r = requests.post(f"{API}/auth/login",
                      json={"email": test_email, "password": test_password}, timeout=30)
    assert_true(r.status_code in (400, 401, 404),
                "deleted user login -> 4xx",
                f"got {r.status_code} {r.text[:120]}")

    # =========================================================
    # Summary
    # =========================================================
    step("Summary")
    total = len(results)
    failed = [r for r in results if not r[1]]
    print(f"  {total - len(failed)} / {total} assertions passed")
    for label, passed, detail in failed:
        print(f"   FAIL: {label} -- {detail}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
