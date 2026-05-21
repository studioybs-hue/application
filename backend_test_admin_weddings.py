"""Test new admin endpoints: GET /api/admin/weddings and POST /api/admin/weddings/merge.
Also regression test POST /api/weddings/unlock with sarahaline-elarif code.
"""
import os
import sys
import requests
import json

BASE = "https://mariagevideo.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"
USER_EMAIL = "test@wedding.fr"
USER_PASSWORD = "test1234"

results = []
def log(name, ok, detail=""):
    mark = "✅" if ok else "❌"
    print(f"{mark} {name} :: {detail}")
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def main():
    # ---- Login admin and basic user ----
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    user_tok = login(USER_EMAIL, USER_PASSWORD)
    admin_h = {"Authorization": f"Bearer {admin_tok}"}
    user_h = {"Authorization": f"Bearer {user_tok}"}
    print(f"Logged in admin and user")

    # =============================================
    # 1) GET /api/admin/weddings
    # =============================================
    # 1a) Unauthenticated → 401
    r = requests.get(f"{BASE}/admin/weddings", timeout=30)
    log("GET /admin/weddings unauth → 401", r.status_code == 401, f"got {r.status_code}: {r.text[:120]}")

    # 1b) Non-admin → 403
    r = requests.get(f"{BASE}/admin/weddings", headers=user_h, timeout=30)
    log("GET /admin/weddings non-admin → 403", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

    # 1c) Admin → 200, list with required fields, sorted desc
    r = requests.get(f"{BASE}/admin/weddings", headers=admin_h, timeout=30)
    log("GET /admin/weddings admin → 200", r.status_code == 200, f"got {r.status_code}")
    data = r.json() if r.status_code == 200 else {}
    weddings = data.get("weddings", [])
    log("GET /admin/weddings has 'weddings' list", isinstance(weddings, list) and len(weddings) > 0,
        f"len={len(weddings)}")
    # Field validation
    if weddings:
        sample = weddings[0]
        required = ["client_id", "client_name", "video_count"]
        all_have = True
        for w in weddings:
            for f in required:
                if f not in w:
                    all_have = False
                    break
            if not isinstance(w.get("client_id"), str) or not isinstance(w.get("client_name"), str):
                all_have = False
            if not isinstance(w.get("video_count"), int) or w.get("video_count") <= 0:
                all_have = False
        log("All weddings have client_id/client_name/video_count>0", all_have, f"sample={sample}")

    # 1d) Sorted desc by created_at (newest first)
    created_at_values = [w.get("created_at") for w in weddings if w.get("created_at")]
    sorted_correct = created_at_values == sorted(created_at_values, reverse=True)
    log("Sorted by created_at desc", sorted_correct,
        f"first 3 created_at: {created_at_values[:3]}")

    # 1e) sarahaline-elarif has video_count == 2
    sarah = next((w for w in weddings if w.get("client_id") == "sarahaline-elarif"), None)
    if sarah:
        log("sarahaline-elarif video_count == 2", sarah["video_count"] == 2,
            f"got video_count={sarah['video_count']}, name={sarah.get('client_name')}")
    else:
        log("sarahaline-elarif present in weddings list", False,
            f"client_ids={[w.get('client_id') for w in weddings]}")

    initial_sarah_count = sarah["video_count"] if sarah else 0

    # =============================================
    # 2) POST /api/admin/weddings/merge
    # =============================================
    # 2a) Non-admin → 403
    r = requests.post(f"{BASE}/admin/weddings/merge",
                      headers=user_h,
                      json={"source_client_ids": ["x"], "target_client_id": "y"}, timeout=30)
    log("POST /admin/weddings/merge non-admin → 403", r.status_code == 403,
        f"got {r.status_code}: {r.text[:120]}")

    # 2b) Missing target_client_id → 400
    r = requests.post(f"{BASE}/admin/weddings/merge",
                      headers=admin_h,
                      json={"source_client_ids": ["x"]}, timeout=30)
    log("POST merge missing target_client_id → 400", r.status_code == 400,
        f"got {r.status_code}: {r.text[:120]}")
    if r.status_code == 400:
        log("Error message contains 'target_client_id'",
            "target_client_id" in r.text, r.text[:200])

    # 2c) Missing source_client_ids → 400
    r = requests.post(f"{BASE}/admin/weddings/merge",
                      headers=admin_h,
                      json={"target_client_id": "sarahaline-elarif"}, timeout=30)
    log("POST merge missing source_client_ids → 400", r.status_code == 400,
        f"got {r.status_code}: {r.text[:120]}")

    # 2d) Empty source_client_ids list → 400
    r = requests.post(f"{BASE}/admin/weddings/merge",
                      headers=admin_h,
                      json={"source_client_ids": [], "target_client_id": "sarahaline-elarif"}, timeout=30)
    log("POST merge empty source list → 400", r.status_code == 400,
        f"got {r.status_code}: {r.text[:120]}")

    # 2e) Full happy path: create new wedding via admin/videos, merge it into sarahaline-elarif
    # Use a unique title to ensure new client_id
    import uuid
    unique_suffix = uuid.uuid4().hex[:6].upper()
    new_title = f"TestMergeWedding {unique_suffix}"
    expected_cid = "testmergewedding-" + unique_suffix.lower()
    r = requests.post(f"{BASE}/admin/videos",
                      headers=admin_h,
                      json={
                          "title": new_title,
                          "description": "Test merge video",
                          "category": "À l'affiche",
                          "poster_url": "https://example.com/p.jpg",
                          "trailer_url": "https://example.com/t.mp4",
                          "full_url": "https://example.com/f.mp4",
                          "duration_minutes": 5,
                          "client_name": new_title,
                      }, timeout=30)
    created_video = None
    if r.status_code == 200:
        created_video = r.json().get("video", {})
        log(f"Created test video (client_id={created_video.get('client_id')})", True,
            f"video id={created_video.get('id')}")
    else:
        log("Created test video", False, f"got {r.status_code}: {r.text[:200]}")
        return

    test_cid = created_video.get("client_id")

    # Verify new wedding appears in GET /admin/weddings
    r = requests.get(f"{BASE}/admin/weddings", headers=admin_h, timeout=30)
    weddings = r.json().get("weddings", []) if r.status_code == 200 else []
    appears = any(w.get("client_id") == test_cid for w in weddings)
    log(f"New wedding '{test_cid}' appears in /admin/weddings", appears, f"")

    # Now merge it into sarahaline-elarif
    r = requests.post(f"{BASE}/admin/weddings/merge",
                      headers=admin_h,
                      json={
                          "source_client_ids": [test_cid],
                          "target_client_id": "sarahaline-elarif",
                          "target_client_name": "Sarahaline & Elarif",
                      }, timeout=30)
    log("POST merge happy path → 200", r.status_code == 200,
        f"got {r.status_code}: {r.text[:200]}")
    merge_resp = r.json() if r.status_code == 200 else {}
    log("Merge response ok:true", merge_resp.get("ok") is True, f"resp={merge_resp}")
    log("Merge response target_client_id == sarahaline-elarif",
        merge_resp.get("target_client_id") == "sarahaline-elarif",
        f"got {merge_resp.get('target_client_id')}")
    log("Merge response moved >= 1",
        isinstance(merge_resp.get("moved"), int) and merge_resp.get("moved") >= 1,
        f"got moved={merge_resp.get('moved')}")

    # Verify merge: test wedding gone, sarahaline count increased by 1
    r = requests.get(f"{BASE}/admin/weddings", headers=admin_h, timeout=30)
    weddings = r.json().get("weddings", []) if r.status_code == 200 else []
    test_still_present = any(w.get("client_id") == test_cid for w in weddings)
    log(f"After merge: test wedding '{test_cid}' is gone", not test_still_present, "")
    sarah_after = next((w for w in weddings if w.get("client_id") == "sarahaline-elarif"), None)
    if sarah_after:
        log(f"After merge: sarahaline-elarif count grew by 1 ({initial_sarah_count} → {initial_sarah_count + 1})",
            sarah_after["video_count"] == initial_sarah_count + 1,
            f"got {sarah_after['video_count']}, name={sarah_after.get('client_name')}")
    else:
        log("sarahaline-elarif still exists after merge", False, "")

    # =============================================
    # 3) REGRESSION: GET /weddings/sarahaline-elarif should include the new test video
    # =============================================
    # Find any active code for sarahaline-elarif. Use admin/codes to list.
    r = requests.get(f"{BASE}/admin/codes", headers=admin_h, timeout=30)
    sarah_code = None
    if r.status_code == 200:
        for c in r.json().get("codes", []):
            if c.get("client_id") == "sarahaline-elarif" and c.get("is_active"):
                sarah_code = c["code"]
                break
    if not sarah_code:
        # Create one as admin
        r = requests.post(f"{BASE}/admin/codes",
                          headers=admin_h,
                          json={"client_id": "sarahaline-elarif", "label": "Test merge regression"}, timeout=30)
        if r.status_code == 200:
            sarah_code = r.json().get("code")
            print(f"Created fresh admin code for sarahaline-elarif: {sarah_code}")
        else:
            log("Failed to obtain a code for sarahaline-elarif", False, f"{r.status_code}: {r.text[:200]}")
            sarah_code = None

    if sarah_code:
        r = requests.get(f"{BASE}/weddings/sarahaline-elarif", params={"code": sarah_code}, timeout=30)
        if r.status_code == 200:
            data = r.json()
            vids = data.get("videos", [])
            unlocked = data.get("unlocked", False)
            log("GET /weddings/sarahaline-elarif?code=... unlocked", unlocked, f"unlocked={unlocked}")
            log("Wedding has >= 3 videos after merge (was 2 + 1)",
                len(vids) >= 3, f"video_count_in_response={len(vids)}, titles={[v['title'] for v in vids]}")
            has_test_vid = any(v.get("title") == new_title for v in vids)
            log(f"Merged test video '{new_title}' is in videos[]", has_test_vid, "")
        else:
            log("GET /weddings/sarahaline-elarif", False, f"got {r.status_code}: {r.text[:200]}")

        # 4) REGRESSION: POST /api/weddings/unlock
        r = requests.post(f"{BASE}/weddings/unlock",
                          json={"code": sarah_code, "device_id": "TEST_DEVICE_001"}, timeout=30)
        # NOTE: this code might already be bound to a different device. Try anyway.
        if r.status_code == 200:
            d = r.json()
            log("POST /weddings/unlock → 200", True, f"video_count={d.get('video_count')}")
            log("unlock video_count >= 2", d.get("video_count", 0) >= 2,
                f"got {d.get('video_count')}")
            vids = d.get("videos", [])
            log("unlock videos[] length >= 2", len(vids) >= 2, f"len={len(vids)}")
            all_have_full_url = all(v.get("full_url") for v in vids)
            log("All unlocked videos have full_url", all_have_full_url,
                f"full_urls=[{[bool(v.get('full_url')) for v in vids]}]")
        elif r.status_code == 403:
            # Code already bound to a different device — try to create a brand new code
            print(f"Code {sarah_code} already bound to another device, creating fresh one...")
            r2 = requests.post(f"{BASE}/admin/codes",
                               headers=admin_h,
                               json={"client_id": "sarahaline-elarif", "label": "Fresh regression code"}, timeout=30)
            if r2.status_code == 200:
                fresh = r2.json().get("code")
                r3 = requests.post(f"{BASE}/weddings/unlock",
                                   json={"code": fresh, "device_id": "TEST_DEVICE_001"}, timeout=30)
                if r3.status_code == 200:
                    d = r3.json()
                    log("POST /weddings/unlock with FRESH code → 200", True,
                        f"video_count={d.get('video_count')}")
                    log("unlock video_count >= 2", d.get("video_count", 0) >= 2, f"got {d.get('video_count')}")
                    vids = d.get("videos", [])
                    log("unlock videos[] length >= 2", len(vids) >= 2, f"len={len(vids)}")
                    log("All unlocked videos have full_url",
                        all(v.get("full_url") for v in vids), "")
                else:
                    log("POST /weddings/unlock with fresh code", False,
                        f"got {r3.status_code}: {r3.text[:200]}")
            else:
                log("Could not create fresh code", False, f"{r2.status_code}: {r2.text[:200]}")
        else:
            log("POST /weddings/unlock", False, f"got {r.status_code}: {r.text[:200]}")

    # ---- Cleanup: delete the test video we created (find by client_id == sarahaline-elarif and title == new_title)
    r = requests.get(f"{BASE}/admin/videos", headers=admin_h, timeout=30)
    if r.status_code == 200:
        for v in r.json().get("videos", []):
            if v.get("title") == new_title:
                requests.delete(f"{BASE}/admin/videos/{v['id']}", headers=admin_h, timeout=30)
                print(f"Cleaned up test video {v['id']}")
                break

    # Summary
    print("\n=== SUMMARY ===")
    pass_n = sum(1 for _, ok, _ in results if ok)
    print(f"{pass_n}/{len(results)} assertions passed")
    failed = [(n, d) for n, ok, d in results if not ok]
    if failed:
        print("\nFAILED:")
        for n, d in failed:
            print(f"  ❌ {n}  ::  {d}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
