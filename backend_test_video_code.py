"""Tests for GET /api/videos/{video_id}?code=... anonymous unlock via wedding code."""
import os
import sys
import requests

BASE = "https://mariagevideo.preview.emergentagent.com/api"
TEST_EMAIL = "test@wedding.fr"
TEST_PASS = "test1234"
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


def must(cond, label):
    print(("PASS" if cond else "FAIL") + " :: " + label)
    if not cond:
        global FAILED
        FAILED += 1


FAILED = 0


def login(email, pwd):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd})
    r.raise_for_status()
    return r.json()["access_token"]


def main():
    global FAILED
    # 1) GET /api/weddings/public -- pick video ids
    r = requests.get(f"{BASE}/weddings/public")
    must(r.status_code == 200, "[1] GET /weddings/public 200")
    weddings = r.json().get("weddings", [])

    hanifa = None
    other = None
    for w in weddings:
        cid = w.get("client_id")
        if cid == "hanifa-et-dali":
            hanifa = w
        else:
            other = w
    must(hanifa is not None, "[1] hanifa-et-dali wedding found")
    must(other is not None, "[1] another wedding found for cross-test")

    # Need actual video ids -> fetch wedding details
    r = requests.get(f"{BASE}/weddings/hanifa-et-dali")
    must(r.status_code == 200, "[1] GET /weddings/hanifa-et-dali 200")
    hanifa_videos = r.json().get("videos", [])
    must(len(hanifa_videos) >= 1, "[1] hanifa has at least 1 video")
    hanifa_video_id = hanifa_videos[0]["id"]
    print(f"  hanifa video_id = {hanifa_video_id}, title = {hanifa_videos[0].get('title')}")

    other_cid = other["client_id"]
    r = requests.get(f"{BASE}/weddings/{other_cid}")
    must(r.status_code == 200, f"[1] GET /weddings/{other_cid} 200")
    other_videos = r.json().get("videos", [])
    must(len(other_videos) >= 1, f"[1] {other_cid} has at least 1 video")
    other_video_id = other_videos[0]["id"]
    print(f"  other_cid = {other_cid}, video_id = {other_video_id}")

    # 2) POST /api/client/codes as test@wedding.fr
    test_token = login(TEST_EMAIL, TEST_PASS)
    r = requests.post(f"{BASE}/client/codes", json={"label": "VideoCodeTest"}, headers=hdr(test_token))
    must(r.status_code == 200, "[2] POST /client/codes 200")
    code = r.json().get("code")
    must(bool(code), f"[2] code returned = {code}")
    cid_in_resp = r.json().get("client_id")
    must(cid_in_resp == "hanifa-et-dali", f"[2] code tied to hanifa-et-dali (got {cid_in_resp})")

    # 3) GET /api/videos/{id} no auth, no code -> full_url null
    r = requests.get(f"{BASE}/videos/{hanifa_video_id}")
    must(r.status_code == 200, "[3] GET /videos/{id} no auth no code 200")
    body = r.json()
    must(body.get("full_url") is None, f"[3] full_url is None (got {body.get('full_url')!r})")

    # 4) GET /api/videos/{id}?code=valid -> full_url non-null
    r = requests.get(f"{BASE}/videos/{hanifa_video_id}", params={"code": code})
    must(r.status_code == 200, "[4] GET /videos/{id}?code=valid 200")
    body = r.json()
    must(body.get("full_url") is not None, f"[4] full_url non-null (got {body.get('full_url')!r})")

    # 5) GET /api/videos/{id}?code=INVALID -> full_url null
    r = requests.get(f"{BASE}/videos/{hanifa_video_id}", params={"code": "INVALID"})
    must(r.status_code == 200, "[5] GET /videos/{id}?code=INVALID 200")
    body = r.json()
    must(body.get("full_url") is None, f"[5] invalid code -> full_url None (got {body.get('full_url')!r})")

    # 6) Cross-wedding: other_video_id with hanifa code -> full_url null
    r = requests.get(f"{BASE}/videos/{other_video_id}", params={"code": code})
    must(r.status_code == 200, "[6] GET /videos/{other}?code=hanifa_code 200")
    body = r.json()
    must(body.get("full_url") is None, f"[6] cross-wedding -> full_url None (got {body.get('full_url')!r})")

    # 7) Admin token, no code -> full_url non-null
    admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
    r = requests.get(f"{BASE}/videos/{hanifa_video_id}", headers=hdr(admin_token))
    must(r.status_code == 200, "[7] GET /videos/{id} as admin 200")
    body = r.json()
    must(body.get("full_url") is not None, f"[7] admin -> full_url non-null (got {body.get('full_url')!r})")

    # 8) Logged-in test user: POST /weddings/unlock then GET /videos/{id} (no code)
    r = requests.post(f"{BASE}/weddings/unlock", json={"code": code, "device_id": "TESTDEV"}, headers=hdr(test_token))
    must(r.status_code == 200, f"[8a] POST /weddings/unlock 200 (got {r.status_code} body={r.text[:200]})")
    must(r.json().get("ok") is True, "[8a] unlock ok=true")

    r = requests.get(f"{BASE}/videos/{hanifa_video_id}", headers=hdr(test_token))
    must(r.status_code == 200, "[8b] GET /videos/{id} as test user (no code) 200")
    body = r.json()
    must(body.get("full_url") is not None, f"[8b] wedding-level unlock -> full_url non-null (got {body.get('full_url')!r})")

    # 9) Cleanup: DELETE /api/client/codes/{code}
    r = requests.delete(f"{BASE}/client/codes/{code}", headers=hdr(test_token))
    must(r.status_code == 200, f"[9] DELETE /client/codes/{{code}} 200 (got {r.status_code})")
    must(r.json().get("ok") is True, "[9] delete ok=true")

    print()
    if FAILED == 0:
        print(f"ALL TESTS PASSED")
    else:
        print(f"{FAILED} tests FAILED")
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
