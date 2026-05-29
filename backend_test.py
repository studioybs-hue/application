"""
Backend test for the NEW Public Showcase Videos feature.
Targets: https://mariagevideo.preview.emergentagent.com/api
"""
import sys
import uuid
import requests

BASE = "https://mariagevideo.preview.emergentagent.com/api"

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASSWORD = "Admin13!"

FREE_USER_CANDIDATES = [
    ("test@wedding.fr", "test1234"),
    ("test@wedding.fr", "TestPass123!"),
]

assertions = []


def rec(label, cond, info=""):
    status = "PASS" if cond else "FAIL"
    assertions.append((status, label, info))
    print(f"[{status}] {label}{(' — ' + info) if info and not cond else ''}")
    return cond


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code == 200:
        return r.json()["access_token"], r.json()["user"]
    return None, None


def register(email, password, full_name):
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": password, "full_name": full_name},
        timeout=20,
    )
    if r.status_code == 200:
        return r.json()["access_token"], r.json()["user"]
    return None, None


def auth_h(token):
    return {"Authorization": f"Bearer {token}"}


def main():
    admin_token, _ = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        rec("Admin login", False, "could not authenticate admin@wedding.fr")
        finish_summary()
        return
    rec("Admin login admin@wedding.fr", True)

    free_token = None
    for email, pwd in FREE_USER_CANDIDATES:
        tok, usr = login(email, pwd)
        if tok:
            free_token = tok
            print(f"[INFO] Free user logged in: {email}")
            break
    if not free_token:
        fresh_email = f"showcase_user_{uuid.uuid4().hex[:8]}@example.com"
        fresh_pwd = "ShowcaseTest!9"
        free_token, _ = register(fresh_email, fresh_pwd, "Showcase Tester")
        if not free_token:
            rec("Free user registration fallback", False, fresh_email)
            finish_summary()
            return
        print(f"[INFO] Registered fresh free user: {fresh_email}")
    rec("Free/non-admin user token obtained", True)

    # ===== a) Anonymous /videos/showcase =====
    print("\n=== a) GET /api/videos/showcase (anonymous) ===")
    r = requests.get(f"{BASE}/videos/showcase", timeout=20)
    rec("a) anon /videos/showcase HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")
    anon_total_initial = 0
    if r.status_code == 200:
        data = r.json()
        rec("a) anon is_authenticated == false", data.get("is_authenticated") is False, str(data.get("is_authenticated")))
        rec("a) response has rows[]/featured[]/total", isinstance(data.get("rows"), list) and isinstance(data.get("featured"), list) and isinstance(data.get("total"), int))
        anon_total_initial = data.get("total", 0)
        all_full_null = True
        all_have_trailer_poster = True
        for row in data.get("rows", []):
            for v in row.get("videos", []):
                if v.get("full_url") is not None:
                    all_full_null = False
                if not v.get("trailer_url") or not v.get("poster_url"):
                    all_have_trailer_poster = False
        for v in data.get("featured", []):
            if v.get("full_url") is not None:
                all_full_null = False
        rec("a) every showcase video has full_url=null when anonymous", all_full_null)
        if anon_total_initial > 0:
            rec("a) every video has trailer_url + poster_url populated", all_have_trailer_poster)
        else:
            print(f"[INFO] (a) Baseline showcase total = {anon_total_initial}")

    # ===== b) Admin auth /videos/showcase =====
    print("\n=== b) GET /api/videos/showcase (admin auth) ===")
    r = requests.get(f"{BASE}/videos/showcase", headers=auth_h(admin_token), timeout=20)
    rec("b) admin /videos/showcase HTTP 200", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        rec("b) admin is_authenticated == true", data.get("is_authenticated") is True)
        all_videos = list(data.get("featured", []))
        for row in data.get("rows", []):
            all_videos.extend(row.get("videos", []))
        if all_videos:
            ok_full = all(v.get("full_url") is not None for v in all_videos)
            rec("b) admin sees full_url populated (not None) for all showcase videos", ok_full)
        else:
            print("[INFO] (b) No existing showcase videos — full_url check vacuous")

    # ===== c) Create new video with is_showcase=true =====
    print("\n=== c) POST /api/admin/videos is_showcase=true ===")
    payload = {
        "title": f"Showcase Demo {uuid.uuid4().hex[:6].upper()}",
        "description": "Démo publique pour tests automatisés",
        "category": "À l'affiche",
        "poster_url": "https://example.com/poster.jpg",
        "hero_url": "https://example.com/hero.jpg",
        "trailer_url": "https://example.com/trailer.mp4",
        "full_url": "https://example.com/full.mp4",
        "duration_minutes": 5,
        "is_featured": True,
        "is_top_france": False,
        "is_showcase": True,
        "client_name": "Démo Cinemariés",
    }
    r = requests.post(f"{BASE}/admin/videos", headers=auth_h(admin_token), json=payload, timeout=20)
    rec("c) POST /admin/videos HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")
    created_id = None
    if r.status_code == 200:
        body = r.json()
        rec("c) response.video exists", isinstance(body.get("video"), dict))
        v = body.get("video", {})
        created_id = v.get("id")
        rec("c) created video.is_showcase === true", v.get("is_showcase") is True, str(v.get("is_showcase")))
        rec("c) created video has id", bool(created_id))

    if not created_id:
        print("[ABORT] Could not create showcase video.")
        finish_summary()
        return

    # ===== d) Anon /videos/showcase includes new video =====
    print("\n=== d) Anon /videos/showcase should now include new video ===")
    r = requests.get(f"{BASE}/videos/showcase", timeout=20)
    if r.status_code == 200:
        data = r.json()
        new_total = data.get("total")
        rec("d) total increased by 1", new_total == anon_total_initial + 1,
            f"before={anon_total_initial} after={new_total}")
        found, found_cat = False, None
        for row in data.get("rows", []):
            for v in row.get("videos", []):
                if v.get("id") == created_id:
                    found = True
                    found_cat = row.get("category")
        rec("d) new video appears in /videos/showcase rows", found, f"category={found_cat}")
        if found_cat:
            rec("d) appears in category 'À l'affiche'", found_cat == "À l'affiche", f"row={found_cat}")
        # Category ordering check
        cats = [row.get("category") for row in data.get("rows", [])]
        preferred = ["À l'affiche", "Cérémonies", "Soirées", "Best Of"]
        present_in_order = [c for c in preferred if c in cats]
        actual_subset = [c for c in cats if c in preferred]
        rec("d) preferred category ordering respected", present_in_order == actual_subset,
            f"actual_subset={actual_subset} expected_subset={present_in_order}")

    # ===== e) PATCH is_showcase=false → total decreases =====
    print("\n=== e) PATCH is_showcase=false ===")
    r = requests.patch(
        f"{BASE}/admin/videos/{created_id}",
        headers=auth_h(admin_token),
        json={"is_showcase": False},
        timeout=20,
    )
    rec("e) PATCH HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        rec("e) response.video.is_showcase === false", r.json().get("video", {}).get("is_showcase") is False)
    r2 = requests.get(f"{BASE}/videos/showcase", timeout=20)
    if r2.status_code == 200:
        rec("e) total back to baseline after disable",
            r2.json().get("total") == anon_total_initial,
            f"baseline={anon_total_initial} got={r2.json().get('total')}")

    # ===== f) Re-enable & free user gets full_url without code =====
    print("\n=== f) Re-enable + free user GET /videos/{id} (no code) ===")
    r = requests.patch(
        f"{BASE}/admin/videos/{created_id}",
        headers=auth_h(admin_token),
        json={"is_showcase": True},
        timeout=20,
    )
    rec("f) re-enable PATCH HTTP 200", r.status_code == 200)
    if r.status_code == 200:
        rec("f) re-enabled video.is_showcase === true", r.json().get("video", {}).get("is_showcase") is True)

    r = requests.get(f"{BASE}/videos/{created_id}", headers=auth_h(free_token), timeout=20)
    rec("f) free-user GET /videos/{id} HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        v = r.json()
        rec("f) free user sees full_url NOT None (showcase auto-unlock works)",
            v.get("full_url") is not None,
            f"full_url={v.get('full_url')!r} is_showcase={v.get('is_showcase')}")
        rec("f) full_url == uploaded url",
            v.get("full_url") == "https://example.com/full.mp4",
            f"got {v.get('full_url')!r}")

    # ===== g) Anonymous GET /videos/{id} → full_url MUST be null =====
    print("\n=== g) Anonymous GET /videos/{id} for showcase video ===")
    r = requests.get(f"{BASE}/videos/{created_id}", timeout=20)
    rec("g) anon GET /videos/{id} HTTP 200", r.status_code == 200)
    if r.status_code == 200:
        v = r.json()
        rec("g) anon full_url IS None for showcase video without auth",
            v.get("full_url") is None,
            f"full_url={v.get('full_url')!r}")
        rec("g) anon sees poster_url and trailer_url populated",
            bool(v.get("poster_url")) and bool(v.get("trailer_url")))
        rec("g) anon sees is_showcase=true", v.get("is_showcase") is True)

    # ===== h) Regression =====
    print("\n=== h) Regression sweep ===")
    r = requests.get(f"{BASE}/weddings/public", timeout=20)
    rec("h) GET /weddings/public HTTP 200", r.status_code == 200)
    wp = {}
    if r.status_code == 200:
        wp = r.json()
        rec("h) /weddings/public has weddings list", isinstance(wp.get("weddings"), list))

    if wp.get("weddings"):
        any_cid = wp["weddings"][0]["client_id"]
        rr = requests.get(f"{BASE}/weddings/{any_cid}", timeout=20)
        rec(f"h) GET /weddings/{any_cid} HTTP 200", rr.status_code == 200)
        if rr.status_code == 200:
            wd = rr.json()
            rec("h) wedding doc has videos[]", isinstance(wd.get("videos"), list))

    print("\n  Unlock with seed code S9A5URZC + device_id=SHOWCASE_TEST_DEV")
    r = requests.post(
        f"{BASE}/weddings/unlock",
        json={"code": "S9A5URZC", "device_id": "SHOWCASE_TEST_DEV", "device_label": "Showcase tester"},
        timeout=20,
    )
    rec("h) POST /weddings/unlock with valid code returns 200 or 403", r.status_code in (200, 403),
        f"got {r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        rec("h) unlock 200 returns ok=true + videos[]",
            body.get("ok") is True and isinstance(body.get("videos"), list))

    r = requests.get(f"{BASE}/library", headers=auth_h(free_token), timeout=20)
    rec("h) GET /library (auth) HTTP 200", r.status_code == 200)
    if r.status_code == 200:
        rec("h) /library returns 'videos' list", isinstance(r.json().get("videos"), list))

    r = requests.get(f"{BASE}/admin/weddings", headers=auth_h(admin_token), timeout=20)
    rec("h) GET /admin/weddings (admin) HTTP 200", r.status_code == 200)
    if r.status_code == 200:
        rec("h) /admin/weddings returns 'weddings' list", isinstance(r.json().get("weddings"), list))

    # ===== i) Cleanup =====
    print("\n=== i) Cleanup ===")
    r = requests.delete(f"{BASE}/admin/videos/{created_id}", headers=auth_h(admin_token), timeout=20)
    rec("i) DELETE created video HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    r = requests.get(f"{BASE}/videos/showcase", timeout=20)
    if r.status_code == 200:
        final_total = r.json().get("total")
        rec("i) post-cleanup total back to baseline",
            final_total == anon_total_initial,
            f"baseline={anon_total_initial} final={final_total}")

    finish_summary()


def finish_summary():
    print("\n" + "=" * 60)
    passed = sum(1 for s, _, _ in assertions if s == "PASS")
    failed = sum(1 for s, _, _ in assertions if s == "FAIL")
    print(f"RESULT: {passed} passed / {failed} failed (total {len(assertions)})")
    if failed:
        print("\nFAILED ASSERTIONS:")
        for s, label, info in assertions:
            if s == "FAIL":
                print(f"  - {label}{' :: ' + info if info else ''}")
    print("=" * 60)
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
