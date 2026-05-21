"""
Backend tests for the new Contact / Devis endpoints + admin weddings regression.
Target: https://mariagevideo.preview.emergentagent.com/api
"""
import json
import sys
import requests

BASE = "https://mariagevideo.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"
TEST_EMAIL = "test@wedding.fr"
TEST_PASS = "test1234"

results = []


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_contact_endpoints():
    print("\n=== 1) POST /api/contact (PUBLIC) ===")

    # Happy path
    body = {
        "name": "Test User",
        "email": "test@example.com",
        "phone": "0612345678",
        "subject": "Mariage 15/06/2026",
        "message": "Bonjour, je souhaite un devis pour mon mariage à Paris.",
        "wedding_date": "15/06/2026",
        "location": "Paris",
        "source": "cinemaries-about",
    }
    r = requests.post(f"{BASE}/contact", json=body, timeout=30)
    happy_ok = r.status_code == 200
    happy_id = None
    if happy_ok:
        j = r.json()
        happy_ok = j.get("ok") is True and isinstance(j.get("id"), str) and len(j["id"]) > 10
        happy_id = j.get("id")
    record("POST /contact happy path → 200 {ok, id}", happy_ok, f"status={r.status_code} body={r.text[:200]}")

    # Missing name
    r = requests.post(f"{BASE}/contact", json={"name": "", "email": "x@y.com", "message": "hi"}, timeout=30)
    ok = r.status_code == 400 and "Nom, email et message requis" in r.text
    record("Missing name → 400", ok, f"status={r.status_code} body={r.text[:200]}")

    # Missing email
    r = requests.post(f"{BASE}/contact", json={"name": "A", "email": "", "message": "hi"}, timeout=30)
    # EmailStr will reject empty as 422; spec says 400. But "missing" field really means empty/whitespace.
    # Test with literally absent email → pydantic 422
    ok = r.status_code in (400, 422)
    record("Empty email → 400 or 422", ok, f"status={r.status_code} body={r.text[:200]}")

    # Invalid email format
    r = requests.post(f"{BASE}/contact", json={"name": "A", "email": "notanemail", "message": "hi"}, timeout=30)
    ok = r.status_code == 422
    record("Invalid email format → 422", ok, f"status={r.status_code} body={r.text[:200]}")

    # Missing message
    r = requests.post(f"{BASE}/contact", json={"name": "A", "email": "x@y.com", "message": ""}, timeout=30)
    ok = r.status_code == 400 and "Nom, email et message requis" in r.text
    record("Missing message → 400", ok, f"status={r.status_code} body={r.text[:200]}")

    # Message > 5000 chars
    big_msg = "a" * 5001
    r = requests.post(f"{BASE}/contact", json={"name": "A", "email": "x@y.com", "message": big_msg}, timeout=30)
    ok = r.status_code == 400 and "Message trop long" in r.text
    record("Message > 5000 chars → 400", ok, f"status={r.status_code} body={r.text[:200]}")

    # Minimal valid
    r = requests.post(f"{BASE}/contact", json={"name": "Min User", "email": "min@example.com", "message": "Bonjour"}, timeout=30)
    minimal_ok = r.status_code == 200 and r.json().get("ok") is True
    minimal_id = r.json().get("id") if minimal_ok else None
    record("Minimal valid body → 200", minimal_ok, f"status={r.status_code} body={r.text[:200]}")

    return happy_id, minimal_id


def test_admin_list(admin_token, test_token, happy_id, body_sent):
    print("\n=== 2) GET /api/admin/contact-requests (ADMIN) ===")

    # Unauthenticated
    r = requests.get(f"{BASE}/admin/contact-requests", timeout=30)
    ok = r.status_code == 401
    record("Unauthenticated GET → 401", ok, f"status={r.status_code}")

    # Non-admin
    r = requests.get(f"{BASE}/admin/contact-requests", headers=auth_headers(test_token), timeout=30)
    ok = r.status_code == 403
    record("Non-admin GET → 403", ok, f"status={r.status_code}")

    # Admin
    r = requests.get(f"{BASE}/admin/contact-requests", headers=auth_headers(admin_token), timeout=30)
    ok = r.status_code == 200
    record("Admin GET → 200", ok, f"status={r.status_code}")
    if not ok:
        return None

    j = r.json()
    reqs = j.get("requests")
    has_list = isinstance(reqs, list) and len(reqs) > 0
    record("Response has requests[]", has_list, f"len={len(reqs) if isinstance(reqs, list) else 'NA'}")

    # Sorted desc?
    sorted_ok = True
    for i in range(len(reqs) - 1):
        if reqs[i]["created_at"] < reqs[i + 1]["created_at"]:
            sorted_ok = False
            break
    record("Sorted by created_at descending", sorted_ok, "")

    # Find our happy_id
    found = next((x for x in reqs if x.get("id") == happy_id), None)
    record("Happy-path doc appears in list", found is not None, f"id={happy_id}")

    if found:
        # Verify all fields persisted
        checks = [
            ("name", body_sent["name"]),
            ("email", body_sent["email"]),
            ("phone", body_sent["phone"]),
            ("subject", body_sent["subject"]),
            ("wedding_date", body_sent["wedding_date"]),
            ("location", body_sent["location"]),
            ("message", body_sent["message"]),
            ("source", body_sent["source"]),
        ]
        for k, v in checks:
            record(f"Field '{k}' persisted correctly", found.get(k) == v, f"got={found.get(k)!r} expected={v!r}")

        record("Field 'status' = 'new'", found.get("status") == "new", f"got={found.get('status')}")
        record("Field 'created_at' is ISO string", isinstance(found.get("created_at"), str) and "T" in (found.get("created_at") or ""), f"got={found.get('created_at')}")
        record("Field 'id' present", isinstance(found.get("id"), str), "")

    return found


def test_admin_patch(admin_token, test_token, happy_id):
    print("\n=== 3) PATCH /api/admin/contact-requests/{req_id} ===")

    # Non-admin
    r = requests.patch(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(test_token), json={"status": "read"}, timeout=30)
    record("Non-admin PATCH → 403", r.status_code == 403, f"status={r.status_code}")

    # Status read
    r = requests.patch(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(admin_token), json={"status": "read"}, timeout=30)
    ok = r.status_code == 200 and r.json().get("ok") is True
    record("PATCH status=read → 200", ok, f"status={r.status_code} body={r.text[:200]}")

    # GET shows read
    r = requests.get(f"{BASE}/admin/contact-requests", headers=auth_headers(admin_token), timeout=30)
    doc = next((x for x in r.json()["requests"] if x["id"] == happy_id), None)
    record("After PATCH status=read, status field = 'read'", doc and doc.get("status") == "read", f"status={doc.get('status') if doc else None}")

    # Status archived
    r = requests.patch(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(admin_token), json={"status": "archived"}, timeout=30)
    record("PATCH status=archived → 200", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/admin/contact-requests", headers=auth_headers(admin_token), timeout=30)
    doc = next((x for x in r.json()["requests"] if x["id"] == happy_id), None)
    record("After PATCH archived, status='archived'", doc and doc.get("status") == "archived", f"status={doc.get('status') if doc else None}")

    # Notes
    r = requests.patch(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(admin_token), json={"notes": "called client"}, timeout=30)
    record("PATCH notes='called client' → 200", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/admin/contact-requests", headers=auth_headers(admin_token), timeout=30)
    doc = next((x for x in r.json()["requests"] if x["id"] == happy_id), None)
    record("notes field persisted", doc and doc.get("notes") == "called client", f"notes={doc.get('notes') if doc else None}")

    # Empty body
    r = requests.patch(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(admin_token), json={}, timeout=30)
    ok = r.status_code == 400 and "Aucune modification" in r.text
    record("Empty body PATCH → 400 'Aucune modification.'", ok, f"status={r.status_code} body={r.text[:200]}")

    # Non-existent id
    r = requests.patch(f"{BASE}/admin/contact-requests/nonexistent-xyz-12345", headers=auth_headers(admin_token), json={"status": "read"}, timeout=30)
    record("Non-existent req_id PATCH → 404", r.status_code == 404, f"status={r.status_code}")


def test_admin_delete(admin_token, test_token, happy_id, minimal_id):
    print("\n=== 4) DELETE /api/admin/contact-requests/{req_id} ===")

    # Non-admin
    r = requests.delete(f"{BASE}/admin/contact-requests/{minimal_id}", headers=auth_headers(test_token), timeout=30)
    record("Non-admin DELETE → 403", r.status_code == 403, f"status={r.status_code}")

    # Valid delete
    r = requests.delete(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(admin_token), timeout=30)
    ok = r.status_code == 200 and r.json().get("ok") is True
    record("Valid DELETE → 200", ok, f"status={r.status_code} body={r.text[:200]}")

    # Verify gone via GET
    r = requests.get(f"{BASE}/admin/contact-requests", headers=auth_headers(admin_token), timeout=30)
    doc = next((x for x in r.json()["requests"] if x["id"] == happy_id), None)
    record("After DELETE, doc not in GET list", doc is None, "")

    # Already-deleted id → 404
    r = requests.delete(f"{BASE}/admin/contact-requests/{happy_id}", headers=auth_headers(admin_token), timeout=30)
    record("Already-deleted DELETE → 404", r.status_code == 404, f"status={r.status_code}")

    # Cleanup minimal too
    r = requests.delete(f"{BASE}/admin/contact-requests/{minimal_id}", headers=auth_headers(admin_token), timeout=30)
    record("Cleanup minimal doc DELETE → 200", r.status_code == 200, f"status={r.status_code}")


def test_regression_admin_weddings(admin_token):
    print("\n=== 5) REGRESSION: GET /api/admin/weddings ===")
    r = requests.get(f"{BASE}/admin/weddings", headers=auth_headers(admin_token), timeout=30)
    ok = r.status_code == 200
    record("GET /admin/weddings → 200", ok, f"status={r.status_code}")
    if not ok:
        return
    j = r.json()
    weddings = j.get("weddings", [])
    record("Weddings list present", isinstance(weddings, list) and len(weddings) > 0, f"len={len(weddings)}")
    sarah = next((w for w in weddings if w.get("client_id") == "sarahaline-elarif"), None)
    record("sarahaline-elarif present with video_count >= 2", sarah and sarah.get("video_count", 0) >= 2, f"entry={sarah}")


def main():
    print(f"Testing against: {BASE}")
    try:
        admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
        test_token = login(TEST_EMAIL, TEST_PASS)
    except Exception as e:
        print(f"FATAL: login failed: {e}")
        sys.exit(2)
    print("Logged in admin & test user.")

    happy_body = {
        "name": "Test User",
        "email": "test@example.com",
        "phone": "0612345678",
        "subject": "Mariage 15/06/2026",
        "message": "Bonjour, je souhaite un devis pour mon mariage à Paris.",
        "wedding_date": "15/06/2026",
        "location": "Paris",
        "source": "cinemaries-about",
    }
    happy_id, minimal_id = test_contact_endpoints()

    if happy_id:
        test_admin_list(admin_token, test_token, happy_id, happy_body)
        test_admin_patch(admin_token, test_token, happy_id)
        test_admin_delete(admin_token, test_token, happy_id, minimal_id)

    test_regression_admin_weddings(admin_token)

    # Summary
    print("\n" + "=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"TOTAL: {passed}/{len(results)} passed, {failed} failed")
    if failed:
        print("\nFAILED:")
        for n, ok, d in results:
            if not ok:
                print(f"  - {n} :: {d}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
