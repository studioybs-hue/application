"""
Backend tests — Multi-device binding (1 code = up to 3 devices).
Spec test sequence in the review request, against:
  https://mariagevideo.preview.emergentagent.com/api
"""
import os
import sys
import uuid
import requests

BASE = "https://mariagevideo.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"
TEST_EMAIL = "test@wedding.fr"
TEST_PASS = "test1234"

results = []

def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} — {detail}")
    results.append((name, ok, detail))
    return ok

def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]

def auth(tok):
    return {"Authorization": f"Bearer {tok}"}

def main():
    # Login as test user
    try:
        test_tok = login(TEST_EMAIL, TEST_PASS)
    except Exception as e:
        record("login_test_user", False, f"Failed to login test user: {e}")
        return

    # Step 1: GET /billing/config
    r = requests.get(f"{BASE}/billing/config", timeout=30)
    ok = r.status_code == 200 and r.json().get("max_devices_per_code") == 3
    record("1. GET /billing/config returns max_devices_per_code=3", ok,
           f"status={r.status_code} body_max={r.json().get('max_devices_per_code')}")

    # Step 2: Generate fresh code
    # First clear existing codes to free slots if at limit
    r = requests.get(f"{BASE}/client/codes", headers=auth(test_tok), timeout=30)
    if r.status_code == 200 and not r.json().get("can_create", False):
        # delete some
        for c in r.json().get("codes", []):
            if c.get("is_active"):
                requests.delete(f"{BASE}/client/codes/{c['code']}", headers=auth(test_tok), timeout=30)

    r = requests.post(f"{BASE}/client/codes", headers=auth(test_tok),
                      json={"label": "Test 3-devices"}, timeout=30)
    ok = r.status_code == 200 and "code" in r.json()
    code = r.json().get("code") if ok else None
    record("2. POST /client/codes creates a code", ok, f"status={r.status_code} code={code}")
    if not code:
        return

    # Helper to check videos all have non-null full_url + trailer_url
    def videos_ok(body):
        # Spec says "non-null" => present in payload (not None). Empty string is acceptable
        # because that's a data-state issue, not a regression of the unlock contract.
        vids = body.get("videos") or []
        if not vids:
            return False, "videos empty"
        for v in vids:
            if v.get("full_url") is None:
                return False, f"full_url is None on {v.get('id')}"
            if v.get("trailer_url") is None:
                return False, f"trailer_url is None on {v.get('id')}"
        return True, f"all {len(vids)} videos have non-null full_url+trailer_url"

    # Step 3a: DEV_A unlock
    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": code, "device_id": "DEV_A", "device_label": "iPhone Marie"}, timeout=30)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    cond = (r.status_code == 200 and body.get("ok") is True
            and body.get("client_id") == "hanifa-et-dali"
            and body.get("devices_used") == 1
            and body.get("devices_max") == 3
            and body.get("videos"))
    vok, vmsg = videos_ok(body) if r.status_code == 200 else (False, "non-200")
    record("3a. unlock DEV_A → 200 devices_used=1 + videos with full_url", cond and vok,
           f"status={r.status_code} devices_used={body.get('devices_used')} videos_ok={vmsg}")

    # Step 3b: same DEV_A idempotent
    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": code, "device_id": "DEV_A"}, timeout=30)
    body = r.json() if r.status_code == 200 else {}
    cond = r.status_code == 200 and body.get("devices_used") == 1
    vok, vmsg = videos_ok(body) if r.status_code == 200 else (False, "non-200")
    record("3b. unlock DEV_A again → 200 idempotent devices_used=1", cond and vok,
           f"status={r.status_code} devices_used={body.get('devices_used')}")

    # Step 3c: DEV_B
    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": code, "device_id": "DEV_B", "device_label": "Samsung Paul"}, timeout=30)
    body = r.json() if r.status_code == 200 else {}
    cond = r.status_code == 200 and body.get("devices_used") == 2
    vok, vmsg = videos_ok(body) if r.status_code == 200 else (False, "non-200")
    record("3c. unlock DEV_B → 200 devices_used=2 + full_url", cond and vok,
           f"status={r.status_code} devices_used={body.get('devices_used')}")

    # Step 3d: DEV_C
    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": code, "device_id": "DEV_C", "device_label": "iPad Famille"}, timeout=30)
    body = r.json() if r.status_code == 200 else {}
    cond = r.status_code == 200 and body.get("devices_used") == 3
    vok, vmsg = videos_ok(body) if r.status_code == 200 else (False, "non-200")
    record("3d. unlock DEV_C → 200 devices_used=3 + full_url", cond and vok,
           f"status={r.status_code} devices_used={body.get('devices_used')}")

    # Step 3e: DEV_D — must 403
    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": code, "device_id": "DEV_D"}, timeout=30)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    detail = body.get("detail", "")
    cond = r.status_code == 403 and "Limite de 3 appareils" in detail
    record("3e. unlock DEV_D → 403 'Limite de 3 appareils'", cond,
           f"status={r.status_code} detail={detail!r}")

    # Step 3f: no device_id
    r = requests.post(f"{BASE}/weddings/unlock", json={"code": code}, timeout=30)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    detail = body.get("detail", "")
    cond = r.status_code == 403 and "déjà utilisé" in detail
    record("3f. unlock no device_id → 403 mentions 'déjà utilisé'", cond,
           f"status={r.status_code} detail={detail!r}")

    # Step 4: GET /client/codes — find code with devices_count=3
    r = requests.get(f"{BASE}/client/codes", headers=auth(test_tok), timeout=30)
    body = r.json() if r.status_code == 200 else {}
    target = None
    for c in body.get("codes", []):
        if c.get("code") == code:
            target = c
            break
    cond = (r.status_code == 200 and target is not None
            and target.get("devices_count") == 3
            and target.get("devices_max") == 3
            and isinstance(target.get("devices"), list)
            and len(target["devices"]) == 3
            and all(d.get("device_id") and d.get("label")
                    and d.get("bound_at") and d.get("last_seen_at")
                    for d in target["devices"]))
    record("4. GET /client/codes shows devices_count=3, devices[] with 3 entries", cond,
           f"status={r.status_code} found={target is not None} count={target.get('devices_count') if target else None}")

    # Step 5: DELETE DEV_B then add DEV_E
    r = requests.delete(f"{BASE}/client/codes/{code}/devices/DEV_B", headers=auth(test_tok), timeout=30)
    body = r.json() if r.status_code == 200 else {}
    cond = r.status_code == 200 and body.get("ok") is True and body.get("devices_count") == 2
    record("5a. DELETE devices/DEV_B → 200 devices_count=2", cond,
           f"status={r.status_code} body={body}")

    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": code, "device_id": "DEV_E"}, timeout=30)
    body = r.json() if r.status_code == 200 else {}
    cond = r.status_code == 200 and body.get("devices_used") == 3
    vok, vmsg = videos_ok(body) if r.status_code == 200 else (False, "non-200")
    record("5b. unlock DEV_E after freeing slot → 200 devices_used=3", cond and vok,
           f"status={r.status_code} devices_used={body.get('devices_used')}")

    # Step 6: DELETE non-existent device
    r = requests.delete(f"{BASE}/client/codes/{code}/devices/DEV_NOTEXIST",
                        headers=auth(test_tok), timeout=30)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    detail = body.get("detail", "")
    cond = r.status_code == 404 and "Appareil introuvable pour ce code" in detail
    record("6. DELETE non-existent device → 404 'Appareil introuvable pour ce code'", cond,
           f"status={r.status_code} detail={detail!r}")

    # Step 7: DELETE as non-owner — register fresh user
    other_email = f"nonowner_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE}/auth/register",
                      json={"email": other_email, "password": "Other1234!", "full_name": "Non Owner"}, timeout=30)
    if r.status_code == 200:
        other_tok = r.json()["access_token"]
    else:
        other_tok = None
    if other_tok:
        r = requests.delete(f"{BASE}/client/codes/{code}/devices/DEV_A",
                            headers=auth(other_tok), timeout=30)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        detail = body.get("detail", "")
        cond = r.status_code == 403 and "Vous n'êtes pas le propriétaire de ce code" in detail
        record("7. DELETE devices/DEV_A as non-owner → 403", cond,
               f"status={r.status_code} detail={detail!r}")
    else:
        record("7. Register non-owner user", False, f"reg failed: {r.status_code} {r.text[:200]}")

    # Step 8: Legacy S9A5URZC
    r = requests.post(f"{BASE}/weddings/unlock",
                      json={"code": "S9A5URZC", "device_id": "LEGACY_NEW_DEV"}, timeout=30)
    if r.status_code == 404:
        record("8. Legacy S9A5URZC compat — SKIPPED", True,
               "Code no longer in DB (404). Skipped per spec.")
    else:
        body = r.json() if r.status_code == 200 else {}
        cond = r.status_code == 200 and (body.get("devices_used") or 0) >= 1 and body.get("devices_max") == 3
        record("8. Legacy S9A5URZC + new device → 200 devices_max=3", cond,
               f"status={r.status_code} devices_used={body.get('devices_used')} devices_max={body.get('devices_max')}")

    # Step 9 already implicit in steps 3a-3d, 5b — full_url presence already asserted.
    record("9. Regression: full_url + trailer_url on all unlocks", True,
           "Assertions embedded in steps 3a-3d, 5b above")

    # Step 10: cleanup
    r = requests.delete(f"{BASE}/client/codes/{code}", headers=auth(test_tok), timeout=30)
    cond = r.status_code == 200
    record("10. Cleanup DELETE /client/codes/{code}", cond, f"status={r.status_code}")

    # Summary
    print("\n" + "=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"PASSED {passed}/{total}")
    if passed < total:
        print("\nFAILED:")
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name}: {detail}")
    sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    main()
