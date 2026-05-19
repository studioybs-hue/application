"""Backend tests for CINÉMARIÉS — Stripe billing + regression checks."""
import os
import json
import sys
import time
import requests

BASE_URL = os.environ.get("BACKEND_URL", "https://mariagevideo.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test@wedding.fr"
TEST_PASSWORD = "test1234"

results = []


def log(name, ok, detail=""):
    icon = "✅" if ok else "❌"
    print(f"{icon} {name} — {detail}")
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    return r


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_billing_config():
    r = requests.get(f"{API}/billing/config", timeout=30)
    try:
        data = r.json()
    except Exception:
        return log("GET /api/billing/config", False, f"Non-JSON response status={r.status_code} body={r.text[:200]}")
    ok = (
        r.status_code == 200
        and isinstance(data.get("publishable_key"), str)
        and data["publishable_key"].startswith("pk_test_")
        and data.get("price_amount") == 199
        and data.get("price_currency") == "eur"
        and data.get("configured") is True
    )
    log("GET /api/billing/config", ok, f"status={r.status_code} body={data}")
    return ok


def test_login_and_get_user():
    r = login(TEST_EMAIL, TEST_PASSWORD)
    if r.status_code != 200:
        log("POST /api/auth/login (test user)", False, f"status={r.status_code} body={r.text[:200]}")
        return None, None
    body = r.json()
    token = body.get("access_token")
    uid = body.get("user", {}).get("id")
    log("POST /api/auth/login (test user)", True, f"user_id={uid}")
    return token, uid


def test_checkout_unauthorized():
    r = requests.post(f"{API}/billing/checkout", json={}, timeout=30)
    ok = r.status_code == 401
    log("POST /api/billing/checkout (no auth) → 401", ok, f"status={r.status_code} body={r.text[:200]}")
    return ok


def test_checkout(token):
    r = requests.post(f"{API}/billing/checkout", headers=auth_header(token), json={}, timeout=60)
    try:
        data = r.json()
    except Exception:
        log("POST /api/billing/checkout", False, f"non-JSON status={r.status_code} body={r.text[:300]}")
        return None
    ok = (
        r.status_code == 200
        and isinstance(data.get("url"), str)
        and data["url"].startswith("https://checkout.stripe.com/")
        and isinstance(data.get("session_id"), str)
        and data["session_id"].startswith("cs_test_")
    )
    log("POST /api/billing/checkout", ok, f"status={r.status_code} url={data.get('url','')[:80]} sid={data.get('session_id','')[:25]}")
    return data if ok else None


def test_me_has_stripe_customer(token):
    # /api/auth/me does not expose stripe_customer_id (UserPublic). Use a different signal:
    # after a successful checkout, re-call checkout — it should NOT recreate a customer.
    # We just confirm /auth/me returns 200 here.
    r = requests.get(f"{API}/auth/me", headers=auth_header(token), timeout=30)
    ok = r.status_code == 200
    log("GET /api/auth/me", ok, f"status={r.status_code}")
    return r.json() if ok else None


def test_cancel_no_subscription(token):
    r = requests.post(f"{API}/billing/cancel", headers=auth_header(token), timeout=30)
    ok = r.status_code == 404
    try:
        data = r.json()
        detail = data.get("detail", "")
    except Exception:
        detail = r.text
    # check French message
    french_ok = isinstance(detail, str) and ("Aucun abonnement" in detail or "abonnement" in detail.lower())
    log("POST /api/billing/cancel (no sub) → 404 fr", ok and french_ok, f"status={r.status_code} detail={detail}")
    return ok and french_ok


def test_cancel_unauthorized():
    r = requests.post(f"{API}/billing/cancel", timeout=30)
    ok = r.status_code == 401
    log("POST /api/billing/cancel (no auth) → 401", ok, f"status={r.status_code}")
    return ok


def test_webhook_subscription_completed(user_id):
    payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "mode": "subscription",
                "customer": "cus_TEST_FAKE",
                "subscription": "sub_TEST_FAKE",
                "metadata": {"user_id": user_id},
            }
        },
    }
    r = requests.post(f"{API}/billing/webhook", json=payload, timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {}
    ok = r.status_code == 200 and data.get("received") is True
    log("POST /api/billing/webhook (checkout.session.completed)", ok, f"status={r.status_code} body={data}")
    return ok


def test_me_is_subscribed(token, expected=True):
    r = requests.get(f"{API}/auth/me", headers=auth_header(token), timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {}
    ok = r.status_code == 200 and data.get("is_subscribed") is expected
    log(f"GET /api/auth/me is_subscribed=={expected}", ok, f"status={r.status_code} is_subscribed={data.get('is_subscribed')}")
    return ok


def test_webhook_subscription_deleted():
    payload = {
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "customer": "cus_TEST_FAKE",
                "status": "canceled",
            }
        },
    }
    r = requests.post(f"{API}/billing/webhook", json=payload, timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {}
    ok = r.status_code == 200 and data.get("received") is True
    log("POST /api/billing/webhook (customer.subscription.deleted)", ok, f"status={r.status_code} body={data}")
    return ok


def test_videos_public():
    r = requests.get(f"{API}/videos/public", timeout=30)
    ok = r.status_code == 200 and "featured" in r.json() and "rows" in r.json()
    log("GET /api/videos/public", ok, f"status={r.status_code}")
    return ok


def test_weddings_public():
    r = requests.get(f"{API}/weddings/public", timeout=30)
    ok = r.status_code == 200 and "weddings" in r.json()
    log("GET /api/weddings/public", ok, f"status={r.status_code}")
    return ok


def test_unlock_code():
    r = requests.post(f"{API}/weddings/unlock", json={"code": "S9A5URZC"}, timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {}
    if r.status_code == 200 and data.get("ok") is True:
        log("POST /api/weddings/unlock (S9A5URZC)", True, "active code → ok:true")
        return True
    # acceptable failure: 404 'Code invalide' or 429 'Code épuisé'
    detail = data.get("detail", "")
    acceptable = r.status_code in (404, 410, 429) and ("Code invalide" in detail or "Code épuisé" in detail or "Code expiré" in detail)
    log("POST /api/weddings/unlock (S9A5URZC)", acceptable, f"status={r.status_code} detail={detail}")
    return acceptable


def main():
    print(f"=== Running backend tests against: {API} ===\n")

    # 1. Config (public)
    test_billing_config()

    # 2. Login
    token, uid = test_login_and_get_user()
    if not token:
        print("\nCannot proceed without login token.")
        sys.exit(1)

    # 3. Reset user is_subscribed=False to make the cancel/webhook tests deterministic
    # We can't reset directly via API; use admin login to reach a route — but the tests will just verify flips.

    # 4. Cancel auth check
    test_cancel_unauthorized()

    # 5. Ensure user has no active sub: just hit cancel — expect 404 (assuming no real sub).
    test_cancel_no_subscription(token)

    # 6. Checkout (auth required)
    test_checkout_unauthorized()
    checkout_data = test_checkout(token)

    # 7. Confirm /auth/me still works
    me = test_me_has_stripe_customer(token)

    # 8. Webhook → checkout.session.completed → is_subscribed=true
    test_webhook_subscription_completed(uid)
    time.sleep(0.5)
    test_me_is_subscribed(token, expected=True)

    # 9. Webhook → customer.subscription.deleted → is_subscribed=false
    test_webhook_subscription_deleted()
    time.sleep(0.5)
    test_me_is_subscribed(token, expected=False)

    # 10. Regression
    test_videos_public()
    test_weddings_public()
    test_unlock_code()

    print("\n=== Summary ===")
    failed = [r for r in results if not r[1]]
    print(f"Total: {len(results)} | Passed: {len(results) - len(failed)} | Failed: {len(failed)}")
    for name, ok, detail in failed:
        print(f"  ❌ {name}: {detail}")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
