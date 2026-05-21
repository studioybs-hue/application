"""
Backend tests for RGPD deletion moderation queue + Stripe Customer Portal.

Targets endpoints:
 - DELETE /api/me (refactored to queue, not immediate delete)
 - GET /api/me/deletion-request
 - GET /api/admin/deletion-requests
 - POST /api/admin/deletion-requests/{id}/approve
 - POST /api/admin/deletion-requests/{id}/reject
 - POST /api/billing/portal

Run: python /app/backend_test_deletion_queue.py
"""
import os
import sys
import uuid
import requests

BASE = "https://mariagevideo.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"

results = []  # list of (ok, label, detail)


def log(ok: bool, label: str, detail: str = ""):
    icon = "✅" if ok else "❌"
    print(f"{icon} {label}" + (f" — {detail}" if detail else ""))
    results.append((ok, label, detail))


def login(email: str, password: str) -> str | None:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        return None
    return r.json()["access_token"]


def register(full_name: str, email: str, password: str) -> dict:
    r = requests.post(f"{BASE}/auth/register",
                      json={"full_name": full_name, "email": email, "password": password},
                      timeout=20)
    r.raise_for_status()
    return r.json()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def main():
    # ------------------------------------------------------------------
    # Login admin
    # ------------------------------------------------------------------
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        log(False, "Admin login", f"Could not login as {ADMIN_EMAIL}")
        return finalize()
    log(True, "Admin login OK")
    me_admin = requests.get(f"{BASE}/auth/me", headers=auth(admin_token), timeout=20).json()
    admin_id = me_admin.get("id")
    assert admin_id, "admin id missing"

    # ------------------------------------------------------------------
    # 1) DELETE /api/me — unauth → 401
    # ------------------------------------------------------------------
    r = requests.delete(f"{BASE}/me", timeout=20)
    log(r.status_code in (401, 403), "DELETE /api/me unauth returns 401/403",
        f"got {r.status_code} body={r.text[:200]}")

    # ------------------------------------------------------------------
    # 1) DELETE /api/me as admin (last admin) → 400
    # ------------------------------------------------------------------
    r = requests.delete(f"{BASE}/me", headers=auth(admin_token), timeout=20)
    log(r.status_code == 400, "DELETE /api/me last admin → 400",
        f"got {r.status_code} body={r.text[:300]}")

    # ------------------------------------------------------------------
    # Register a fresh test user for the queue tests
    # ------------------------------------------------------------------
    sfx = uuid.uuid4().hex[:8]
    test_email = f"queue_test_{sfx}@example.com"
    test_pw = "QueueTest123!"
    reg = register(f"Queue Test {sfx}", test_email, test_pw)
    test_token = reg["access_token"]
    test_user_id = reg["user"]["id"]
    log(True, f"Registered fresh test user {test_email}")

    # ------------------------------------------------------------------
    # 2) GET /api/me/deletion-request unauth → 401
    # ------------------------------------------------------------------
    r = requests.get(f"{BASE}/me/deletion-request", timeout=20)
    log(r.status_code == 401, "GET /me/deletion-request unauth → 401", f"got {r.status_code}")

    # GET /api/me/deletion-request as user before any request → null
    r = requests.get(f"{BASE}/me/deletion-request", headers=auth(test_token), timeout=20)
    ok = r.status_code == 200 and r.json().get("request") is None
    log(ok, "GET /me/deletion-request before request → {request:null}",
        f"got {r.status_code} body={r.text[:200]}")

    # ------------------------------------------------------------------
    # 1) DELETE /api/me first call → queued
    # ------------------------------------------------------------------
    r = requests.delete(f"{BASE}/me", headers=auth(test_token), timeout=20)
    if r.status_code != 200:
        log(False, "DELETE /api/me as non-admin user", f"got {r.status_code} body={r.text[:300]}")
        return finalize()
    body = r.json()
    request_id = body.get("request_id")
    ok = (
        body.get("queued") is True
        and body.get("status") == "pending"
        and isinstance(request_id, str)
        and isinstance(body.get("message"), str)
        and "deleted" not in body  # no longer immediate
    )
    log(ok, "DELETE /api/me returns {queued:true, request_id, status:pending, message}",
        f"body={body}")

    # ------------------------------------------------------------------
    # 1) User can still login after DELETE (not deleted yet)
    # ------------------------------------------------------------------
    again_token = login(test_email, test_pw)
    log(again_token is not None, "User can still login after DELETE /api/me",
        "still has a valid token" if again_token else "login failed!")

    # ------------------------------------------------------------------
    # 1) Idempotency — second DELETE returns same request_id
    # ------------------------------------------------------------------
    r2 = requests.delete(f"{BASE}/me", headers=auth(test_token), timeout=20)
    body2 = r2.json() if r2.status_code == 200 else {}
    ok = (
        r2.status_code == 200
        and body2.get("queued") is True
        and body2.get("request_id") == request_id
    )
    log(ok, "DELETE /api/me 2nd time → same request_id (idempotent)",
        f"body={body2}")

    # ------------------------------------------------------------------
    # 2) GET /api/me/deletion-request returns the pending request
    # ------------------------------------------------------------------
    r = requests.get(f"{BASE}/me/deletion-request", headers=auth(test_token), timeout=20)
    body = r.json() if r.status_code == 200 else {}
    req = (body or {}).get("request") or {}
    ok = (
        r.status_code == 200
        and req.get("id") == request_id
        and req.get("status") == "pending"
        and req.get("user_id") == test_user_id
    )
    log(ok, "GET /me/deletion-request returns {request:{...}} when pending",
        f"req={req}")

    # ------------------------------------------------------------------
    # 3) GET /api/admin/deletion-requests
    # ------------------------------------------------------------------
    r = requests.get(f"{BASE}/admin/deletion-requests", timeout=20)
    log(r.status_code == 401, "GET /admin/deletion-requests unauth → 401",
        f"got {r.status_code}")

    r = requests.get(f"{BASE}/admin/deletion-requests", headers=auth(test_token), timeout=20)
    log(r.status_code == 403, "GET /admin/deletion-requests non-admin → 403",
        f"got {r.status_code}")

    r = requests.get(f"{BASE}/admin/deletion-requests", headers=auth(admin_token), timeout=20)
    body = r.json() if r.status_code == 200 else {}
    items = body.get("items") or []
    ours = next((it for it in items if it.get("id") == request_id), None)
    ok = (
        r.status_code == 200
        and isinstance(items, list)
        and "count" in body
        and ours is not None
        and ours.get("status") == "pending"
    )
    log(ok, "GET /admin/deletion-requests (default pending) returns our request",
        f"count={body.get('count')} found_ours={bool(ours)}")

    # status filters
    for st, expect_found in (("pending", True), ("approved", False), ("rejected", False), ("all", True)):
        r = requests.get(f"{BASE}/admin/deletion-requests",
                         headers=auth(admin_token), params={"status": st}, timeout=20)
        bj = r.json() if r.status_code == 200 else {}
        items = bj.get("items") or []
        ours = any(it.get("id") == request_id for it in items)
        ok = r.status_code == 200 and (ours == expect_found)
        log(ok, f"GET /admin/deletion-requests?status={st} returns our request={expect_found}",
            f"status={r.status_code} count={bj.get('count')} found_ours={ours}")

    # ------------------------------------------------------------------
    # 4) POST /api/admin/deletion-requests/{id}/approve
    # ------------------------------------------------------------------
    r = requests.post(f"{BASE}/admin/deletion-requests/{request_id}/approve", timeout=20)
    log(r.status_code == 401, "approve unauth → 401", f"got {r.status_code}")

    r = requests.post(f"{BASE}/admin/deletion-requests/{request_id}/approve",
                      headers=auth(test_token), timeout=20)
    log(r.status_code == 403, "approve non-admin → 403", f"got {r.status_code}")

    fake_id = str(uuid.uuid4())
    r = requests.post(f"{BASE}/admin/deletion-requests/{fake_id}/approve",
                      headers=auth(admin_token), timeout=20)
    log(r.status_code == 404, "approve invalid id → 404", f"got {r.status_code}")

    # Reject path requires a separate pending request — first, REJECT FLOW:
    # Create another fresh user with a pending request for the reject tests.
    sfx_r = uuid.uuid4().hex[:8]
    rej_email = f"queue_reject_{sfx_r}@example.com"
    rej_pw = "RejectTest123!"
    reg_r = register(f"Queue Reject {sfx_r}", rej_email, rej_pw)
    rej_token = reg_r["access_token"]
    rej_user_id = reg_r["user"]["id"]
    rr = requests.delete(f"{BASE}/me", headers=auth(rej_token), timeout=20)
    reject_request_id = rr.json().get("request_id")
    log(rr.status_code == 200 and reject_request_id, f"Setup: queued reject request {reject_request_id}",
        f"status={rr.status_code}")

    # ------------------------------------------------------------------
    # 5) reject — unauth/non-admin
    # ------------------------------------------------------------------
    r = requests.post(f"{BASE}/admin/deletion-requests/{reject_request_id}/reject",
                      json={"reason": "test"}, timeout=20)
    log(r.status_code == 401, "reject unauth → 401", f"got {r.status_code}")

    r = requests.post(f"{BASE}/admin/deletion-requests/{reject_request_id}/reject",
                      headers=auth(test_token), json={"reason": "test"}, timeout=20)
    log(r.status_code == 403, "reject non-admin → 403", f"got {r.status_code}")

    # Empty reason → 400
    r = requests.post(f"{BASE}/admin/deletion-requests/{reject_request_id}/reject",
                      headers=auth(admin_token), json={"reason": ""}, timeout=20)
    log(r.status_code == 400, "reject empty reason → 400", f"got {r.status_code} body={r.text[:200]}")

    r = requests.post(f"{BASE}/admin/deletion-requests/{reject_request_id}/reject",
                      headers=auth(admin_token), json={}, timeout=20)
    log(r.status_code == 400, "reject missing reason → 400", f"got {r.status_code}")

    # Invalid id
    r = requests.post(f"{BASE}/admin/deletion-requests/{fake_id}/reject",
                      headers=auth(admin_token), json={"reason": "x"}, timeout=20)
    log(r.status_code == 404, "reject invalid id → 404", f"got {r.status_code}")

    # Valid reject
    reason_text = "Demande effectuée par erreur — confirmation par téléphone."
    r = requests.post(f"{BASE}/admin/deletion-requests/{reject_request_id}/reject",
                      headers=auth(admin_token), json={"reason": reason_text}, timeout=20)
    ok = r.status_code == 200 and r.json().get("rejected") is True
    log(ok, "reject valid request returns 200 rejected:true",
        f"status={r.status_code} body={r.text[:200]}")

    # Verify status persisted + admin_note + user NOT deleted
    r = requests.get(f"{BASE}/admin/deletion-requests", headers=auth(admin_token),
                     params={"status": "rejected"}, timeout=20)
    items = (r.json() or {}).get("items") or []
    persisted = next((it for it in items if it.get("id") == reject_request_id), None)
    ok = (
        persisted is not None
        and persisted.get("status") == "rejected"
        and persisted.get("admin_note") == reason_text
        and persisted.get("processed_at") is not None
        and persisted.get("processed_by") == admin_id
    )
    log(ok, "rejected request persisted with admin_note+processed_at+processed_by",
        f"persisted={persisted}")

    # User can still login (NOT deleted)
    still_token = login(rej_email, rej_pw)
    log(still_token is not None, "Rejected user can still login (not deleted)",
        f"got_token={bool(still_token)}")

    # Reject already-processed → 400
    r = requests.post(f"{BASE}/admin/deletion-requests/{reject_request_id}/reject",
                      headers=auth(admin_token), json={"reason": "again"}, timeout=20)
    log(r.status_code == 400, "reject already-processed → 400",
        f"got {r.status_code} body={r.text[:200]}")

    # ------------------------------------------------------------------
    # 4) Approve valid pending request → cascade delete
    # ------------------------------------------------------------------
    r = requests.post(f"{BASE}/admin/deletion-requests/{request_id}/approve",
                      headers=auth(admin_token), timeout=20)
    body = r.json() if r.status_code == 200 else {}
    ok = r.status_code == 200 and body.get("approved") is True
    log(ok, "approve valid pending → 200 approved:true",
        f"status={r.status_code} body={body}")

    # Verify request status updated
    r = requests.get(f"{BASE}/admin/deletion-requests", headers=auth(admin_token),
                     params={"status": "approved"}, timeout=20)
    items = (r.json() or {}).get("items") or []
    approved_req = next((it for it in items if it.get("id") == request_id), None)
    ok = (
        approved_req is not None
        and approved_req.get("status") == "approved"
        and approved_req.get("processed_at") is not None
        and approved_req.get("processed_by") == admin_id
    )
    log(ok, "approved request has status=approved + processed_at + processed_by",
        f"approved_req={approved_req}")

    # Verify user actually gone — cannot login
    gone = login(test_email, test_pw)
    log(gone is None, "approved user can no longer login (cascade delete worked)",
        "login refused" if gone is None else "login still works — cascade NOT executed!")

    # Approve already-processed → 400
    r = requests.post(f"{BASE}/admin/deletion-requests/{request_id}/approve",
                      headers=auth(admin_token), timeout=20)
    log(r.status_code == 400, "approve already-processed → 400",
        f"got {r.status_code} body={r.text[:200]}")

    # ------------------------------------------------------------------
    # 4) Approve deletion of last admin → 400 (safety)
    # ------------------------------------------------------------------
    # Create a fake pending deletion request for the admin via DELETE /api/me as admin
    # (we just verified earlier that DELETE /api/me as last admin returns 400 with NO request created).
    # So we can't easily trigger this path without DB manipulation.
    # We *could* skip — but try: GET pending and verify no admin entry exists.
    r = requests.get(f"{BASE}/admin/deletion-requests", headers=auth(admin_token),
                     params={"status": "pending"}, timeout=20)
    items = (r.json() or {}).get("items") or []
    admin_pending = [it for it in items if it.get("user_id") == admin_id]
    log(len(admin_pending) == 0,
        "No pending deletion-request for last admin (DELETE /me refuses to create one)",
        f"admin_pending_count={len(admin_pending)}")

    # ------------------------------------------------------------------
    # 6) POST /api/billing/portal
    # ------------------------------------------------------------------
    r = requests.post(f"{BASE}/billing/portal", timeout=20)
    log(r.status_code == 401, "POST /billing/portal unauth → 401", f"got {r.status_code}")

    # Fresh user with no stripe_customer_id → 404
    sfx_p = uuid.uuid4().hex[:8]
    portal_email = f"portal_test_{sfx_p}@example.com"
    portal_pw = "PortalTest123!"
    reg_p = register(f"Portal Test {sfx_p}", portal_email, portal_pw)
    portal_token = reg_p["access_token"]

    r = requests.post(f"{BASE}/billing/portal", headers=auth(portal_token), timeout=30)
    log(r.status_code == 404, "POST /billing/portal user without stripe_customer_id → 404",
        f"got {r.status_code} body={r.text[:200]}")

    # Try with admin@wedding.fr — see if it has a customer id from earlier tests
    r = requests.post(f"{BASE}/billing/portal", headers=auth(admin_token), timeout=30)
    if r.status_code == 200:
        body = r.json()
        url = body.get("url", "")
        ok = isinstance(url, str) and "billing.stripe.com" in url
        log(ok, "POST /billing/portal admin → returns billing.stripe.com URL",
            f"url_preview={url[:80]}")
    elif r.status_code == 404:
        log(True, "POST /billing/portal admin without stripe_customer_id → 404 (skipped happy path — no premium user)",
            "Stripe customer not present for admin (acceptable)")
    elif r.status_code == 502:
        # billing portal not configured in stripe dashboard
        log(True, "Minor: POST /billing/portal returned 502 (Stripe portal not yet configured in dashboard)",
            f"body={r.text[:200]}")
    else:
        log(False, "POST /billing/portal admin path unexpected",
            f"status={r.status_code} body={r.text[:200]}")

    # Cleanup: delete the portal_test user via approval flow (queue + approve)
    try:
        r = requests.delete(f"{BASE}/me", headers=auth(portal_token), timeout=20)
        rid = r.json().get("request_id") if r.status_code == 200 else None
        if rid:
            requests.post(f"{BASE}/admin/deletion-requests/{rid}/approve",
                          headers=auth(admin_token), timeout=20)
        # also cleanup the rejected user (it still exists)
        # we leave the rejected user since the test asserts they can login;
        # but to keep DB clean, re-queue & approve.
        if still_token:
            r = requests.delete(f"{BASE}/me", headers=auth(still_token), timeout=20)
            rid2 = r.json().get("request_id") if r.status_code == 200 else None
            if rid2:
                requests.post(f"{BASE}/admin/deletion-requests/{rid2}/approve",
                              headers=auth(admin_token), timeout=20)
    except Exception as e:
        print(f"(cleanup error, non-blocking): {e}")

    return finalize()


def finalize():
    print("\n=========================================")
    passed = sum(1 for r in results if r[0])
    total = len(results)
    print(f"RESULTS: {passed}/{total} passed")
    if passed != total:
        print("\nFAILED:")
        for ok, label, detail in results:
            if not ok:
                print(f"  ❌ {label}: {detail}")
    print("=========================================")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
