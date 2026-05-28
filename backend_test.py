"""
Backend test suite for CINÉMARIÉS subscription system refactor.
Tests against the public Emergent URL.
"""
import os
import sys
import time
import json
from datetime import datetime, timezone, timedelta

import requests
from pymongo import MongoClient

# --- Config ---
BACKEND_URL = "https://mariagevideo.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"
TEST_EMAIL = "test@wedding.fr"
TEST_PASSWORD = "test1234"

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wedding_stream"

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

# --- Helpers ---
PASS = 0
FAIL = 0
FAILURES = []


def check(label: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        FAILURES.append(f"{label} — {detail}")
        print(f"  ❌ {label} — {detail}")


def section(title: str):
    print(f"\n=== {title} ===")


def login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def set_user_field(email: str, updates: dict, unsets: list = None):
    upd = {}
    if updates:
        upd["$set"] = updates
    if unsets:
        upd["$unset"] = {k: "" for k in unsets}
    if upd:
        db.users.update_one({"email": email}, upd)


# ---------------------------------------------------------------
# A) GET /api/billing/config (public, no auth)
# ---------------------------------------------------------------
def test_billing_config():
    section("A) GET /api/billing/config (public)")
    r = requests.get(f"{API}/billing/config", timeout=30)
    check("Status 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code != 200:
        return
    data = r.json()
    plans = data.get("plans")
    check("Has `plans` array", isinstance(plans, list), f"plans={plans}")
    check("Exactly 3 plans", isinstance(plans, list) and len(plans) == 3, f"len={len(plans) if plans else None}")
    if not isinstance(plans, list):
        return
    required_keys = {"code", "label", "amount", "interval", "engagement", "tier"}
    for p in plans:
        missing = required_keys - set(p.keys())
        check(f"Plan {p.get('code')} has required keys", not missing, f"missing={missing}")
    by_code = {p["code"]: p for p in plans}

    if "annual_commit" in by_code:
        p = by_code["annual_commit"]
        check("annual_commit amount=2388", p["amount"] == 2388, f"got {p['amount']}")
        check("annual_commit interval=year", p["interval"] == "year", f"got {p['interval']}")
        check("annual_commit engagement=true", p["engagement"] is True, f"got {p['engagement']}")
        check("annual_commit tier=basic", p["tier"] == "basic", f"got {p['tier']}")
    else:
        check("annual_commit present", False, "missing")

    if "annual_free" in by_code:
        p = by_code["annual_free"]
        check("annual_free amount=2760", p["amount"] == 2760, f"got {p['amount']}")
        check("annual_free interval=year", p["interval"] == "year", f"got {p['interval']}")
        check("annual_free engagement=false", p["engagement"] is False, f"got {p['engagement']}")
        check("annual_free tier=unlimited", p["tier"] == "unlimited", f"got {p['tier']}")
    else:
        check("annual_free present", False, "missing")

    if "monthly_free" in by_code:
        p = by_code["monthly_free"]
        check("monthly_free amount=230", p["amount"] == 230, f"got {p['amount']}")
        check("monthly_free interval=month", p["interval"] == "month", f"got {p['interval']}")
        check("monthly_free engagement=false", p["engagement"] is False, f"got {p['engagement']}")
        check("monthly_free tier=unlimited", p["tier"] == "unlimited", f"got {p['tier']}")
    else:
        check("monthly_free present", False, "missing")


# ---------------------------------------------------------------
# B) POST /api/billing/checkout
# ---------------------------------------------------------------
def test_billing_checkout(user_tok: str):
    section("B) POST /api/billing/checkout")

    # 401 no auth
    r = requests.post(f"{API}/billing/checkout", json={"plan": "monthly_free"}, timeout=30)
    check("Without auth → 401", r.status_code == 401, f"got {r.status_code}")

    cases = [
        ({"plan": "annual_commit"}, "annual_commit", "basic"),
        ({"plan": "annual_free"}, "annual_free", "unlimited"),
        ({"plan": "monthly_free"}, "monthly_free", "unlimited"),
        ({"tier": "basic"}, "monthly_free", None),  # legacy fallback
        ({}, "monthly_free", None),  # default
    ]
    for body, expected_plan, expected_tier in cases:
        r = requests.post(f"{API}/billing/checkout", json=body, headers=hdr(user_tok), timeout=60)
        check(f"checkout {body} → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")
        if r.status_code != 200:
            continue
        data = r.json()
        check(f"  has url ({body})", isinstance(data.get("url"), str) and data["url"].startswith("https://checkout.stripe.com/"), f"url={data.get('url')}")
        check(f"  has session_id ({body})", isinstance(data.get("session_id"), str) and data["session_id"].startswith("cs_"), f"session_id={data.get('session_id')}")
        check(f"  plan={expected_plan} ({body})", data.get("plan") == expected_plan, f"got plan={data.get('plan')}")
        if expected_tier:
            check(f"  tier={expected_tier} ({body})", data.get("tier") == expected_tier, f"got tier={data.get('tier')}")
        # Verify db.checkout_sessions entry has correct plan
        sid = data.get("session_id")
        if sid:
            doc = db.checkout_sessions.find_one({"session_id": sid})
            check(
                f"  db.checkout_sessions has plan={expected_plan} ({body})",
                doc is not None and doc.get("plan") == expected_plan,
                f"doc={doc}",
            )


# ---------------------------------------------------------------
# C) Login on a DEACTIVATED user
# ---------------------------------------------------------------
def test_login_deactivated():
    section("C) POST /api/auth/login on deactivated user")
    try:
        # Step 1: deactivate
        res = db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": False}})
        check("Deactivated test user in mongo", res.matched_count == 1, f"matched={res.matched_count}")

        # Step 2: login still works
        r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
        check("Deactivated login → 200 (not 403)", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")
        if r.status_code != 200:
            return
        body = r.json()
        token = body.get("access_token")
        check("Has access_token", isinstance(token, str) and len(token) > 0)
        user = body.get("user", {})
        check("user.is_active === false in login response", user.get("is_active") is False, f"got is_active={user.get('is_active')}")

        # Step 4: /auth/me
        r = requests.get(f"{API}/auth/me", headers=hdr(token), timeout=30)
        check("/auth/me with that token → 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            me = r.json()
            check("/auth/me is_active=false", me.get("is_active") is False, f"got {me.get('is_active')}")
    finally:
        # RESTORE
        db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": True}})


# ---------------------------------------------------------------
# D) POST /api/billing/cancel-and-deactivate
# ---------------------------------------------------------------
def test_cancel_and_deactivate(admin_tok: str):
    section("D) POST /api/billing/cancel-and-deactivate")
    try:
        # D1. As test user, no active subscription → 200
        # First re-login (user state may have changed)
        # Make sure test user has no subscription_plan & is_active=true & not admin
        set_user_field(TEST_EMAIL, {"is_active": True}, unsets=["subscription_plan", "subscription_ends_at", "stripe_subscription_id"])
        user_tok = login(TEST_EMAIL, TEST_PASSWORD)

        r = requests.post(f"{API}/billing/cancel-and-deactivate", headers=hdr(user_tok), timeout=30)
        check("D1. user no active sub → 200", r.status_code == 200, f"got {r.status_code} {r.text[:300]}")
        if r.status_code == 200:
            data = r.json()
            check("D1. ok=true", data.get("ok") is True, f"got {data}")
            check("D1. is_active=false", data.get("is_active") is False, f"got {data}")

        # D2. /auth/me after → is_active false
        r = requests.get(f"{API}/auth/me", headers=hdr(user_tok), timeout=30)
        check("D2. /auth/me 200", r.status_code == 200)
        if r.status_code == 200:
            check("D2. /auth/me is_active=false", r.json().get("is_active") is False, f"got {r.json()}")

        # D3. As admin → 400 with French message
        r = requests.post(f"{API}/billing/cancel-and-deactivate", headers=hdr(admin_tok), timeout=30)
        check("D3. admin → 400", r.status_code == 400, f"got {r.status_code} {r.text[:200]}")
        if r.status_code == 400:
            detail = r.json().get("detail", "")
            check("D3. french admin message", "administrateur" in detail.lower() or "admin" in detail.lower(), f"detail={detail}")

        # D4. Engagement guard
        # Set test user as annual_commit with future ends_at, reactivate
        future_dt = datetime.now(timezone.utc) + timedelta(days=30)
        set_user_field(TEST_EMAIL, {
            "is_active": True,
            "subscription_plan": "annual_commit",
            "subscription_ends_at": future_dt,
        })
        user_tok = login(TEST_EMAIL, TEST_PASSWORD)
        r = requests.post(f"{API}/billing/cancel-and-deactivate", headers=hdr(user_tok), timeout=30)
        check("D4a. annual_commit future end → 403", r.status_code == 403, f"got {r.status_code} {r.text[:300]}")
        if r.status_code == 403:
            detail = r.json().get("detail", "")
            check("D4a. french message with end date",
                  any(x in detail for x in ["Engagement", "engagement", future_dt.strftime("%d/%m/%Y")]),
                  f"detail={detail}")

        # Set ends_at to past → should allow cancel
        past_dt = datetime.now(timezone.utc) - timedelta(days=1)
        set_user_field(TEST_EMAIL, {
            "is_active": True,
            "subscription_plan": "annual_commit",
            "subscription_ends_at": past_dt,
        })
        user_tok = login(TEST_EMAIL, TEST_PASSWORD)
        r = requests.post(f"{API}/billing/cancel-and-deactivate", headers=hdr(user_tok), timeout=30)
        check("D4b. annual_commit past end → 200", r.status_code == 200, f"got {r.status_code} {r.text[:300]}")

    finally:
        # RESTORE test user
        set_user_field(TEST_EMAIL, {"is_active": True}, unsets=["subscription_plan", "subscription_ends_at", "deactivated_at"])


# ---------------------------------------------------------------
# E) POST /api/billing/reactivate
# ---------------------------------------------------------------
def test_reactivate():
    section("E) POST /api/billing/reactivate")
    try:
        # E1: deactivate test user
        db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": False}})
        # Re-login (login still works on deactivated users now)
        user_tok = login(TEST_EMAIL, TEST_PASSWORD)
        # Confirm deactivated
        me = requests.get(f"{API}/auth/me", headers=hdr(user_tok), timeout=30).json()
        check("E1. user is deactivated pre-reactivate", me.get("is_active") is False, f"got {me.get('is_active')}")

        # E2: POST with plan monthly_free
        r = requests.post(f"{API}/billing/reactivate", json={"plan": "monthly_free"}, headers=hdr(user_tok), timeout=60)
        check("E2. reactivate plan=monthly_free → 200/502/503",
              r.status_code in (200, 502, 503),
              f"got {r.status_code} {r.text[:300]}")
        if r.status_code == 200:
            data = r.json()
            check("E2. has url", isinstance(data.get("url"), str) and data["url"].startswith("https://"),
                  f"url={data.get('url')}")

        # E3: user is_active must be true regardless
        me = requests.get(f"{API}/auth/me", headers=hdr(user_tok), timeout=30).json()
        check("E3. user.is_active === true post-reactivate", me.get("is_active") is True, f"got {me.get('is_active')}")

        # E4: empty plan → fallback to monthly_free
        db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": False}})
        user_tok2 = login(TEST_EMAIL, TEST_PASSWORD)
        r = requests.post(f"{API}/billing/reactivate", json={}, headers=hdr(user_tok2), timeout=60)
        check("E4. empty body → 200/502/503", r.status_code in (200, 502, 503), f"got {r.status_code} {r.text[:300]}")
        me = requests.get(f"{API}/auth/me", headers=hdr(user_tok2), timeout=30).json()
        check("E4. is_active=true after empty-body reactivate", me.get("is_active") is True, f"got {me.get('is_active')}")
    finally:
        db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": True}})


# ---------------------------------------------------------------
# F) SMOKE: existing endpoints still work
# ---------------------------------------------------------------
def test_smoke(admin_tok: str, user_tok: str):
    section("F) Smoke regression")
    r = requests.get(f"{API}/auth/me", headers=hdr(admin_tok), timeout=30)
    check("/auth/me admin → 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.get(f"{API}/weddings/public", timeout=30)
    check("/weddings/public → 200", r.status_code == 200, f"got {r.status_code}")

    r = requests.get(f"{API}/admin/users", headers=hdr(admin_tok), timeout=30)
    check("/admin/users (admin) → 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        body = r.json()
        # Could be list or {users: [...]}
        if isinstance(body, list):
            check("/admin/users returns array", True)
        elif isinstance(body, dict) and isinstance(body.get("users"), list):
            check("/admin/users returns dict with users array", True)
        else:
            check("/admin/users returns array-shape", False, f"got {type(body)} keys={list(body.keys()) if isinstance(body, dict) else None}")

    r = requests.post(f"{API}/support/tickets",
                      json={"subject": "Test post-refactor"},
                      headers=hdr(user_tok), timeout=30)
    check("/support/tickets POST → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")

    r = requests.get(f"{API}/support/tickets", headers=hdr(user_tok), timeout=30)
    check("/support/tickets GET → 200", r.status_code == 200, f"got {r.status_code}")


def main():
    print(f"Testing against: {API}")

    # Sanity: ensure test user is reachable + restore
    db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": True}},
                        upsert=False)
    db.users.update_one({"email": TEST_EMAIL},
                        {"$unset": {"subscription_plan": "", "subscription_ends_at": "", "deactivated_at": ""}})

    admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    user_tok = login(TEST_EMAIL, TEST_PASSWORD)

    try:
        test_billing_config()
        test_billing_checkout(user_tok)
        test_login_deactivated()
        test_cancel_and_deactivate(admin_tok)
        test_reactivate()
        # After above, test user state may have been touched — refresh token
        # Ensure is_active=true
        db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": True}})
        db.users.update_one({"email": TEST_EMAIL},
                            {"$unset": {"subscription_plan": "", "subscription_ends_at": "", "deactivated_at": ""}})
        user_tok = login(TEST_EMAIL, TEST_PASSWORD)
        test_smoke(admin_tok, user_tok)
    finally:
        # FINAL CRITICAL RESTORE
        db.users.update_one({"email": TEST_EMAIL}, {"$set": {"is_active": True}})
        db.users.update_one({"email": TEST_EMAIL},
                            {"$unset": {"subscription_plan": "", "subscription_ends_at": "", "deactivated_at": ""}})

    print(f"\n=========================")
    print(f"RESULTS: {PASS} passed / {FAIL} failed")
    if FAILURES:
        print("FAILURES:")
        for f in FAILURES:
            print(f"  - {f}")
    print(f"=========================")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
