"""Backend tests for CINÉMARIÉS — Sprint 2 endpoints.

Covers:
  1. Device binding on POST /api/weddings/unlock
  2. Client self-service codes (GET/POST/DELETE /api/client/codes)
  3. Admin assign / unassign wedding
  4. Stripe tier in checkout (basic/unlimited) + /api/billing/config
  5. Wedding details with is_my_wedding flag
  6. Regression sanity (public catalog + /auth/me tier+client_id)
"""
import os
import sys
import time
import uuid
import requests
import stripe

BASE_URL = os.environ.get("BACKEND_URL", "https://mariagevideo.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"
TEST_EMAIL = "test@wedding.fr"
TEST_PASSWORD = "test1234"
TEST_CLIENT_ID = "hanifa-et-dali"

# stripe secret key (test mode) - read from backend .env for Checkout Session inspection
STRIPE_SECRET = "sk_test_51T571j2RzyH118YnHKAanbzrhAdhdjlAycv5rwlAe8JHtZAcd3gioZATMLdGa0zrCJRvYzIixzT0YgiUezGBApFH00H38nEawQ"
stripe.api_key = STRIPE_SECRET

results = []  # list of (name, ok, detail)


def log(name, ok, detail=""):
    icon = "✅" if ok else "❌"
    print(f"{icon} {name} — {detail}")
    results.append((name, ok, detail))


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        print(f"!! login failed for {email}: {r.status_code} {r.text}")
        return None, None
    j = r.json()
    return j["access_token"], j["user"]


def register(email, password, full_name):
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "full_name": full_name
    }, timeout=30)
    if r.status_code != 200:
        return None, None, r
    j = r.json()
    return j["access_token"], j["user"], r


# --------- helpers to clean up existing test codes ----------
def admin_list_codes_for_test_user(admin_token, owner_user_id):
    r = requests.get(f"{API}/admin/codes", headers=H(admin_token), timeout=30)
    if r.status_code != 200:
        return []
    return r.json().get("codes", [])


def revoke_all_active_client_codes(admin_token, test_token):
    """Make sure the test user starts with 0 active codes by revoking all current ones."""
    r = requests.get(f"{API}/client/codes", headers=H(test_token), timeout=30)
    if r.status_code != 200:
        return
    for c in r.json().get("codes", []):
        if c.get("is_active"):
            requests.delete(f"{API}/client/codes/{c['code']}", headers=H(test_token), timeout=30)


# ========== TESTS ==========
def section(name):
    print(f"\n========== {name} ==========")


def test_regression_public():
    section("Regression: public endpoints")
    r = requests.get(f"{API}/videos/public", timeout=30)
    log("GET /api/videos/public anon", r.status_code == 200 and "featured" in r.json(),
        f"status={r.status_code}")
    r = requests.get(f"{API}/weddings/public", timeout=30)
    log("GET /api/weddings/public anon", r.status_code == 200 and "weddings" in r.json(),
        f"status={r.status_code}")


def test_login_and_auth_me():
    section("Login + /auth/me returns subscription_tier and client_id")
    admin_tok, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    test_tok, test_user = login(TEST_EMAIL, TEST_PASSWORD)
    if not admin_tok or not test_tok:
        log("Login admin+test", False, "Login failed")
        return None, None, None, None

    log("Login admin@wedding.fr", True, f"id={admin_user['id']} is_admin={admin_user.get('is_admin')}")
    log("Login test@wedding.fr", True, f"id={test_user['id']} client_id={test_user.get('client_id')}")

    # GET /auth/me
    r = requests.get(f"{API}/auth/me", headers=H(admin_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    has_tier = "subscription_tier" in j
    has_cid = "client_id" in j
    log("/auth/me admin has subscription_tier+client_id fields",
        r.status_code == 200 and has_tier and has_cid,
        f"status={r.status_code} tier={j.get('subscription_tier')} client_id={j.get('client_id')}")

    r = requests.get(f"{API}/auth/me", headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("/auth/me test user has tier+client_id",
        r.status_code == 200 and j.get("subscription_tier") == "basic"
        and j.get("client_id") == TEST_CLIENT_ID and j.get("is_subscribed") is True,
        f"status={r.status_code} tier={j.get('subscription_tier')} client_id={j.get('client_id')} subscribed={j.get('is_subscribed')}")

    return admin_tok, admin_user, test_tok, test_user


def test_billing_config():
    section("GET /api/billing/config — Stripe tier metadata")
    r = requests.get(f"{API}/billing/config", timeout=30)
    j = r.json() if r.status_code == 200 else {}
    ok = (
        r.status_code == 200
        and j.get("price_amount") == 199
        and j.get("price_amount_unlimited") == 230
        and j.get("basic_max_codes") == 3
    )
    log("/api/billing/config returns 199/230/3", ok, f"resp={j}")


def test_billing_checkout_tiers(test_tok):
    section("POST /api/billing/checkout — tier=basic/unlimited/invalid")

    # basic
    r = requests.post(f"{API}/billing/checkout", json={"tier": "basic"}, headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    sid_basic = j.get("session_id")
    log("checkout tier=basic → 200", r.status_code == 200 and j.get("url", "").startswith("https://checkout.stripe.com"),
        f"status={r.status_code} session={sid_basic}")

    # verify 199 cents via Stripe API
    if sid_basic:
        try:
            sess = stripe.checkout.Session.retrieve(sid_basic, expand=["line_items"])
            amount = sess["line_items"]["data"][0]["amount_total"] or sess["line_items"]["data"][0]["amount_subtotal"]
            log("basic line_items unit_amount=199", amount == 199, f"amount={amount}")
        except Exception as e:
            log("basic line_items lookup", False, f"err={e}")

    # unlimited
    r = requests.post(f"{API}/billing/checkout", json={"tier": "unlimited"}, headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    sid_unl = j.get("session_id")
    log("checkout tier=unlimited → 200", r.status_code == 200 and j.get("tier") == "unlimited",
        f"status={r.status_code} session={sid_unl} resp_tier={j.get('tier')}")
    if sid_unl:
        try:
            sess = stripe.checkout.Session.retrieve(sid_unl, expand=["line_items"])
            amount = sess["line_items"]["data"][0]["amount_total"] or sess["line_items"]["data"][0]["amount_subtotal"]
            log("unlimited line_items unit_amount=230", amount == 230, f"amount={amount}")
        except Exception as e:
            log("unlimited line_items lookup", False, f"err={e}")

    # invalid tier → falls back to basic
    r = requests.post(f"{API}/billing/checkout", json={"tier": "invalid"}, headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("checkout tier=invalid → falls back to basic 200",
        r.status_code == 200 and j.get("tier") == "basic",
        f"status={r.status_code} tier={j.get('tier')}")


def test_admin_assign_unassign(admin_tok, test_user):
    section("Admin assign-wedding / unassign-wedding")
    user_id = test_user["id"]

    # valid client_id
    r = requests.post(f"{API}/admin/users/{user_id}/assign-wedding",
                      json={"client_id": TEST_CLIENT_ID}, headers=H(admin_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("admin assign valid client_id → 200",
        r.status_code == 200 and j.get("ok") is True and j.get("client_name"),
        f"status={r.status_code} resp={j}")

    # invalid client_id
    r = requests.post(f"{API}/admin/users/{user_id}/assign-wedding",
                      json={"client_id": "nonexistent-wedding"}, headers=H(admin_tok), timeout=30)
    log("admin assign invalid client_id → 404",
        r.status_code == 404 and "introuvable" in r.text.lower(),
        f"status={r.status_code} detail={r.text}")

    # unassign
    r = requests.delete(f"{API}/admin/users/{user_id}/wedding", headers=H(admin_tok), timeout=30)
    log("admin unassign-wedding → 200",
        r.status_code == 200 and r.json().get("ok") is True,
        f"status={r.status_code}")

    # re-assign to restore state for later tests
    r = requests.post(f"{API}/admin/users/{user_id}/assign-wedding",
                      json={"client_id": TEST_CLIENT_ID}, headers=H(admin_tok), timeout=30)
    log("admin re-assign to restore state", r.status_code == 200, f"status={r.status_code}")

    # non-admin attempt
    test_tok, _ = login(TEST_EMAIL, TEST_PASSWORD)
    r = requests.post(f"{API}/admin/users/{user_id}/assign-wedding",
                      json={"client_id": TEST_CLIENT_ID}, headers=H(test_tok), timeout=30)
    log("non-admin assign-wedding → 403",
        r.status_code == 403, f"status={r.status_code} detail={r.text[:120]}")


def test_wedding_is_my_wedding(test_tok):
    section("Wedding details: is_my_wedding flag")
    # auth user
    r = requests.get(f"{API}/weddings/{TEST_CLIENT_ID}", headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("auth test user GET /weddings/hanifa-et-dali is_my_wedding=true",
        r.status_code == 200 and j.get("is_my_wedding") is True,
        f"status={r.status_code} is_my_wedding={j.get('is_my_wedding')}")

    # anon
    r = requests.get(f"{API}/weddings/{TEST_CLIENT_ID}", timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("anonymous GET /weddings/hanifa-et-dali is_my_wedding=false",
        r.status_code == 200 and not j.get("is_my_wedding"),
        f"status={r.status_code} is_my_wedding={j.get('is_my_wedding')}")

    # other wedding
    pub = requests.get(f"{API}/weddings/public", timeout=30).json()
    other_cid = None
    for w in pub.get("weddings", []):
        if w["client_id"] != TEST_CLIENT_ID:
            other_cid = w["client_id"]
            break
    if other_cid:
        r = requests.get(f"{API}/weddings/{other_cid}", headers=H(test_tok), timeout=30)
        j = r.json() if r.status_code == 200 else {}
        log(f"auth test user GET /weddings/{other_cid} is_my_wedding=false",
            r.status_code == 200 and not j.get("is_my_wedding"),
            f"status={r.status_code} is_my_wedding={j.get('is_my_wedding')}")
    else:
        log("Test on another wedding", False, "no other wedding found in /weddings/public")


def test_client_codes(admin_tok, test_tok, test_user):
    section("Client self-service codes (premium owners)")

    # Reset: revoke all active codes for test user
    revoke_all_active_client_codes(admin_tok, test_tok)

    # GET /client/codes
    r = requests.get(f"{API}/client/codes", headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("GET /client/codes → tier=basic limit=3 can_create",
        r.status_code == 200 and j.get("tier") == "basic" and j.get("limit") == 3
        and "can_create" in j and isinstance(j.get("codes"), list),
        f"status={r.status_code} tier={j.get('tier')} limit={j.get('limit')} can_create={j.get('can_create')} codes={len(j.get('codes', []))}")

    # Generate 3 codes
    created_codes = []
    for i, label in enumerate(["Tatie Marie", "Cousin Paul", "Amis lycée"]):
        r = requests.post(f"{API}/client/codes", json={"label": label}, headers=H(test_tok), timeout=30)
        j = r.json() if r.status_code == 200 else {}
        code_val = j.get("code")
        ok = (r.status_code == 200 and code_val and len(code_val) == 8
              and code_val.isalnum() and code_val.isupper())
        log(f"POST /client/codes label='{label}' → 200 generates 8 char code",
            ok, f"status={r.status_code} code={code_val}")
        if code_val:
            created_codes.append(code_val)

    # 4th attempt should hit limit
    r = requests.post(f"{API}/client/codes", json={"label": "4ème"}, headers=H(test_tok), timeout=30)
    body = r.text
    ok = (r.status_code == 403
          and "Limite atteinte" in body and "Illimité" in body)
    log("4th code generation → 403 'Limite atteinte ... Illimité'",
        ok, f"status={r.status_code} detail={body[:200]}")

    # GET should report can_create=false now
    r = requests.get(f"{API}/client/codes", headers=H(test_tok), timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("GET /client/codes can_create=false at limit",
        r.status_code == 200 and j.get("can_create") is False and j.get("active_count") == 3,
        f"can_create={j.get('can_create')} active_count={j.get('active_count')}")

    # DELETE one, can_create true again
    if created_codes:
        to_del = created_codes[-1]
        r = requests.delete(f"{API}/client/codes/{to_del}", headers=H(test_tok), timeout=30)
        log(f"DELETE /client/codes/{to_del} → 200",
            r.status_code == 200 and r.json().get("ok") is True,
            f"status={r.status_code}")
        r = requests.get(f"{API}/client/codes", headers=H(test_tok), timeout=30)
        j = r.json() if r.status_code == 200 else {}
        log("GET /client/codes can_create=true after delete",
            r.status_code == 200 and j.get("can_create") is True,
            f"can_create={j.get('can_create')} active_count={j.get('active_count')}")

    # DELETE as non-owner → 403
    # Register a fresh user, try delete one of test user's codes
    fresh_email = f"nonowner_{uuid.uuid4().hex[:8]}@test.fr"
    tok2, user2, _ = register(fresh_email, "passw0rd123", "Non Owner")
    if created_codes and tok2:
        a_code = created_codes[0]
        r = requests.delete(f"{API}/client/codes/{a_code}", headers=H(tok2), timeout=30)
        log("DELETE /client/codes/{code} as non-owner → 403",
            r.status_code == 403, f"status={r.status_code} detail={r.text[:120]}")

        # Also non-subscribed user creating code → 402
        r = requests.post(f"{API}/client/codes", json={"label": "x"}, headers=H(tok2), timeout=30)
        log("POST /client/codes without is_subscribed → 402",
            r.status_code == 402, f"status={r.status_code} detail={r.text[:200]}")

    # User without client_id (but premium) → 403 "Aucun mariage assigné"
    # We'll create one and have admin set is_subscribed=true via... we cannot set directly.
    # Workaround: assign a wedding then unassign for a premium user. But test@wedding.fr is already premium.
    # We will: unassign test user's wedding temporarily and try POST /client/codes → should be 403
    user_id = test_user["id"]
    r = requests.delete(f"{API}/admin/users/{user_id}/wedding", headers=H(admin_tok), timeout=30)
    if r.status_code == 200:
        r = requests.post(f"{API}/client/codes", json={"label": "test"}, headers=H(test_tok), timeout=30)
        log("POST /client/codes without client_id assigned → 403 'Aucun mariage'",
            r.status_code == 403 and "Aucun mariage" in r.text,
            f"status={r.status_code} detail={r.text[:200]}")
        # also test GET
        r2 = requests.get(f"{API}/client/codes", headers=H(test_tok), timeout=30)
        log("GET /client/codes without client_id → 403 'Aucun mariage'",
            r2.status_code == 403 and "Aucun mariage" in r2.text,
            f"status={r2.status_code} detail={r2.text[:200]}")
        # restore
        requests.post(f"{API}/admin/users/{user_id}/assign-wedding",
                      json={"client_id": TEST_CLIENT_ID}, headers=H(admin_tok), timeout=30)

    return created_codes


def test_device_binding(admin_tok, test_tok):
    section("Device binding on POST /api/weddings/unlock")

    # Generate a fresh code via client API
    r = requests.post(f"{API}/client/codes", json={"label": "Device Test"}, headers=H(test_tok), timeout=30)
    if r.status_code != 200:
        # Maybe limit hit; try DELETE one first
        cr = requests.get(f"{API}/client/codes", headers=H(test_tok), timeout=30)
        for c in cr.json().get("codes", []):
            if c.get("is_active"):
                requests.delete(f"{API}/client/codes/{c['code']}", headers=H(test_tok), timeout=30)
                break
        r = requests.post(f"{API}/client/codes", json={"label": "Device Test"}, headers=H(test_tok), timeout=30)
    if r.status_code != 200:
        log("Could not generate fresh code for device binding test", False, f"status={r.status_code} body={r.text}")
        return
    fresh_code = r.json()["code"]
    log(f"Generated fresh code for device binding test: {fresh_code}", True, "")

    DEVICE_X = f"DEVICE_X_{uuid.uuid4().hex[:8]}"
    DEVICE_Y = f"DEVICE_Y_{uuid.uuid4().hex[:8]}"

    # First unlock with DEVICE_X
    r = requests.post(f"{API}/weddings/unlock",
                      json={"code": fresh_code, "device_id": DEVICE_X, "device_label": "Test PC"},
                      timeout=30)
    j = r.json() if r.status_code == 200 else {}
    log("First unlock binds code to DEVICE_X (200, ok:true)",
        r.status_code == 200 and j.get("ok") is True,
        f"status={r.status_code} client_id={j.get('client_id')}")

    # Same device → idempotent 200
    r = requests.post(f"{API}/weddings/unlock",
                      json={"code": fresh_code, "device_id": DEVICE_X, "device_label": "Test PC"},
                      timeout=30)
    log("Same DEVICE_X re-unlock → 200 (idempotent)",
        r.status_code == 200 and r.json().get("ok") is True,
        f"status={r.status_code}")

    # Different device → 403 with French message
    r = requests.post(f"{API}/weddings/unlock",
                      json={"code": fresh_code, "device_id": DEVICE_Y, "device_label": "Another"},
                      timeout=30)
    body = r.text
    log("Different DEVICE_Y → 403 'déjà utilisé sur un autre appareil'",
        r.status_code == 403 and "déjà utilisé sur un autre appareil" in body,
        f"status={r.status_code} detail={body[:200]}")

    # No device_id when bound → 403
    r = requests.post(f"{API}/weddings/unlock", json={"code": fresh_code}, timeout=30)
    log("No device_id on bound code → 403",
        r.status_code == 403, f"status={r.status_code} detail={r.text[:200]}")

    # Invalid code → 404
    r = requests.post(f"{API}/weddings/unlock", json={"code": "INVALIDXX", "device_id": "DEV_FOO"}, timeout=30)
    log("Invalid code → 404", r.status_code == 404, f"status={r.status_code}")

    # Revoked code → 404 (since revoke sets is_active=false and lookup filters is_active=true)
    # Generate new code, revoke it, try unlock
    r = requests.post(f"{API}/client/codes", json={"label": "ToRevoke"}, headers=H(test_tok), timeout=30)
    if r.status_code == 200:
        revoked = r.json()["code"]
        requests.delete(f"{API}/client/codes/{revoked}", headers=H(test_tok), timeout=30)
        r = requests.post(f"{API}/weddings/unlock", json={"code": revoked, "device_id": "DEV"}, timeout=30)
        log("Revoked code → 404 (or 410)",
            r.status_code in (404, 410), f"status={r.status_code}")
    else:
        log("Generate code to test revoke", False, f"status={r.status_code} body={r.text[:200]}")


def summary():
    section("SUMMARY")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"\nTotal: {len(results)} | ✅ {passed} | ❌ {failed}\n")
    if failed:
        print("Failed:")
        for n, ok, d in results:
            if not ok:
                print(f"  ❌ {n} — {d}")
    return failed == 0


def main():
    test_regression_public()
    admin_tok, admin_user, test_tok, test_user = test_login_and_auth_me()
    if not admin_tok or not test_tok:
        print("Cannot proceed without authentication")
        sys.exit(1)
    test_billing_config()
    test_billing_checkout_tiers(test_tok)
    test_admin_assign_unassign(admin_tok, test_user)
    # need fresh test_tok since assign-unassign-assign mutated user
    test_tok2, _ = login(TEST_EMAIL, TEST_PASSWORD)
    test_wedding_is_my_wedding(test_tok2)
    test_client_codes(admin_tok, test_tok2, test_user)
    # refresh token (state is OK)
    test_tok3, _ = login(TEST_EMAIL, TEST_PASSWORD)
    test_device_binding(admin_tok, test_tok3)
    ok = summary()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
