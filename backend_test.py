"""
Backend test for the NEW Photo Gallery module (photos.py).
Target: https://mariagevideo.preview.emergentagent.com/api
"""

import io
import os
import shutil
import sys
import uuid
import zipfile
from pathlib import Path
from typing import List, Optional

import requests

BASE = "https://mariagevideo.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"

PASS, FAIL = 0, 0
FAILURES: List[str] = []


def check(name: str, ok: bool, info: str = ""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{name} -- {info}")
        print(f"  FAIL {name} -- {info}")


def login(email: str, password: str) -> Optional[str]:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        print(f"  ! login {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json().get("access_token")


def register(email: str, password: str, name: str = "Test User") -> Optional[str]:
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": password, "full_name": name},
        timeout=30,
    )
    if r.status_code != 200:
        print(f"  ! register {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json().get("access_token")


def hdr(token: Optional[str]):
    return {"Authorization": f"Bearer {token}"} if token else {}


def main() -> int:
    print("\n=== STEP 0: Setup tokens ===")
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASS)
    check("Admin login", admin_tok is not None)
    if not admin_tok:
        print("FATAL: cannot login as admin")
        return 1

    test_tok = login("test@wedding.fr", "test1234")
    check("test@wedding.fr login (subscribed user)", test_tok is not None)

    free_email = f"photo_test_{uuid.uuid4().hex[:8]}@example.com"
    free_tok = register(free_email, "Test1234!", "PhotoFree")
    check("Free user register", free_tok is not None)

    print("\n=== STEP 1: Get a wedding_id ===")
    r = requests.get(f"{BASE}/admin/weddings", headers=hdr(admin_tok), timeout=30)
    check("GET /admin/weddings", r.status_code == 200, f"got {r.status_code}")
    weddings = r.json().get("weddings", []) if r.status_code == 200 else []
    check("At least 1 wedding exists", len(weddings) > 0)
    if not weddings:
        return 1
    wedding_id = weddings[0]["client_id"]
    print(f"  wedding_id = {wedding_id}")

    # STEP 2: photos/info - optional auth
    print("\n=== STEP 2: GET /weddings/{id}/photos/info ===")
    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/info", timeout=30)
    check("info anon -> 200", r.status_code == 200, f"{r.status_code} {r.text[:150]}")
    if r.status_code == 200:
        data = r.json()
        check("info anon has_access=false", data.get("has_access") is False, str(data))
        check("info anon access_reason set", bool(data.get("access_reason")), str(data))
        for key in ("wedding_id", "photos_count", "storage_bytes"):
            check(f"info anon has {key}", key in data)

    r = requests.get(f"{BASE}/weddings/__NOPE__nope__/photos/info", timeout=30)
    check("info nonexistent wedding -> 404", r.status_code == 404, f"{r.status_code}")

    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/info", headers=hdr(admin_tok), timeout=30)
    check("info admin -> 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        data = r.json()
        check("info admin has_access=true", data.get("has_access") is True, str(data))

    # STEP 3: Prepare originals/ folder
    print("\n=== STEP 3: Prepare originals/ folder ===")
    base_dir = Path("/app/backend/uploads/photos") / wedding_id
    originals_dir = base_dir / "originals"
    thumbs_dir = base_dir / "thumbs"
    if base_dir.exists():
        shutil.rmtree(base_dir)
    originals_dir.mkdir(parents=True, exist_ok=True)

    src_root = Path("/app/backend/uploads")
    jpgs = sorted([p for p in src_root.iterdir() if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg")])[:3]
    print(f"  copying {len(jpgs)} jpgs into {originals_dir}")
    for j in jpgs:
        shutil.copy2(j, originals_dir / j.name)
    check("Test photos copied to originals/", len(list(originals_dir.iterdir())) >= 2)

    # STEP 4: SCAN
    print("\n=== STEP 4: POST /admin/weddings/{id}/photos/scan ===")
    r = requests.post(f"{BASE}/admin/weddings/{wedding_id}/photos/scan", timeout=30)
    check("scan unauth -> 401", r.status_code == 401, f"{r.status_code}")
    if test_tok:
        r = requests.post(f"{BASE}/admin/weddings/{wedding_id}/photos/scan", headers=hdr(test_tok), timeout=30)
        check("scan non-admin -> 403", r.status_code == 403, f"{r.status_code}")

    r = requests.post(f"{BASE}/admin/weddings/{wedding_id}/photos/scan", headers=hdr(admin_tok), timeout=60)
    check("scan admin -> 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        sd = r.json()
        check("scan ok=True", sd.get("ok") is True)
        check(f"scan added == {len(jpgs)}", sd.get("added") == len(jpgs), str(sd))
        check(f"scan thumbnails_generated == {len(jpgs)}", sd.get("thumbnails_generated") == len(jpgs), str(sd))
        check("scan errors empty", sd.get("errors") == [], str(sd))
        check(f"scan disk_count == {len(jpgs)}", sd.get("disk_count") == len(jpgs), str(sd))

    thumbs_present = thumbs_dir.exists() and any(thumbs_dir.iterdir())
    check("Thumbnails directory populated", thumbs_present)
    if thumbs_present:
        for fn in [j.name for j in jpgs]:
            check(f"thumb file exists: {fn}", (thumbs_dir / fn).exists())

    # idempotent scan
    r = requests.post(f"{BASE}/admin/weddings/{wedding_id}/photos/scan", headers=hdr(admin_tok), timeout=60)
    check("scan again admin -> 200", r.status_code == 200)
    if r.status_code == 200:
        sd = r.json()
        check("scan2 added=0", sd.get("added") == 0, str(sd))
        check(f"scan2 skipped == {len(jpgs)}", sd.get("skipped") == len(jpgs), str(sd))
        check("scan2 no thumbnails generated", sd.get("thumbnails_generated") == 0, str(sd))

    # STEP 5: stats
    print("\n=== STEP 5: GET /admin/weddings/{id}/photos/stats ===")
    r = requests.get(f"{BASE}/admin/weddings/{wedding_id}/photos/stats", headers=hdr(admin_tok), timeout=30)
    check("stats admin -> 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        sd = r.json()
        for k in ("wedding_id", "photos_count", "storage_bytes", "disk_files_count",
                  "needs_scan", "music_filename", "music_size", "max_photos", "originals_path"):
            check(f"stats has {k}", k in sd, str(sd))
        check(f"stats photos_count == {len(jpgs)}", sd.get("photos_count") == len(jpgs), str(sd))
        check(f"stats disk_files_count == {len(jpgs)}", sd.get("disk_files_count") == len(jpgs), str(sd))
        check("stats needs_scan false", sd.get("needs_scan") is False, str(sd))
        check("stats max_photos == 100", sd.get("max_photos") == 100, str(sd))

    r = requests.get(f"{BASE}/admin/weddings/{wedding_id}/photos/stats", headers=hdr(free_tok), timeout=30)
    check("stats non-admin -> 403", r.status_code == 403, f"{r.status_code}")

    # STEP 6: list photos + premium gate
    print("\n=== STEP 6: GET /weddings/{id}/photos ===")
    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos", timeout=30)
    check("list anon -> 402", r.status_code == 402, f"{r.status_code}")

    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos", headers=hdr(free_tok), timeout=30)
    check("list free user -> 402", r.status_code == 402, f"{r.status_code}")
    if r.status_code == 402:
        check("list free user detail == premium_required",
              r.json().get("detail") == "premium_required",
              str(r.json()))

    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos?page=1&per_page=50",
                     headers=hdr(admin_tok), timeout=30)
    check("list admin -> 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    photo_ids: List[str] = []
    if r.status_code == 200:
        photos = r.json()
        check("list admin returns array", isinstance(photos, list))
        check(f"list admin len == {len(jpgs)}", len(photos) == len(jpgs), f"got {len(photos)}")
        if photos:
            p = photos[0]
            for k in ("id", "wedding_id", "filename", "thumb_url", "full_url", "order", "is_favorite", "created_at"):
                check(f"PhotoOut has {k}", k in p, str(list(p.keys())))
            check("thumb_url starts /api/uploads",
                  p["thumb_url"].startswith("/api/uploads/photos/"), p["thumb_url"])
            check("full_url starts /api/uploads",
                  p["full_url"].startswith("/api/uploads/photos/"), p["full_url"])
            photo_ids = [pp["id"] for pp in photos]

    if test_tok:
        r = requests.get(f"{BASE}/weddings/{wedding_id}/photos",
                         headers=hdr(test_tok), timeout=30)
        check("list subscribed user -> 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

    # STEP 7: Favorite toggle
    print("\n=== STEP 7: Favorite toggle ===")
    if not photo_ids:
        check("Skip favorite", False, "no photos")
    else:
        target_id = photo_ids[0]
        r = requests.post(f"{BASE}/weddings/{wedding_id}/photos/{target_id}/favorite", timeout=30)
        check("favorite unauth -> 401", r.status_code == 401, f"{r.status_code}")

        r = requests.post(f"{BASE}/weddings/{wedding_id}/photos/{target_id}/favorite",
                          headers=hdr(admin_tok), timeout=30)
        check("favorite admin first -> 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            check("favorite first is_favorite=true",
                  r.json().get("is_favorite") is True, str(r.json()))

        r2 = requests.get(f"{BASE}/weddings/{wedding_id}/photos",
                          headers=hdr(admin_tok), timeout=30)
        if r2.status_code == 200:
            ph = next((p for p in r2.json() if p["id"] == target_id), None)
            check("listing reflects is_favorite=true",
                  ph is not None and ph.get("is_favorite") is True, str(ph))

        r = requests.post(f"{BASE}/weddings/{wedding_id}/photos/{target_id}/favorite",
                          headers=hdr(admin_tok), timeout=30)
        check("favorite admin second -> 200", r.status_code == 200)
        if r.status_code == 200:
            check("favorite second is_favorite=false",
                  r.json().get("is_favorite") is False, str(r.json()))

    # STEP 8: Download
    print("\n=== STEP 8: Download ===")
    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/download?ids=all",
                     headers=hdr(free_tok), timeout=30)
    check("download free user -> 402", r.status_code == 402, f"{r.status_code}")

    if photo_ids:
        r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/download?ids={photo_ids[0]}",
                         headers=hdr(admin_tok), timeout=60)
        check("download single -> 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            ctype = r.headers.get("content-type", "")
            check("download single content-type image/*", "image" in ctype, ctype)
            check("download single body non-empty", len(r.content) > 100)

    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/download?ids=all",
                     headers=hdr(admin_tok), timeout=120)
    check("download all -> 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        ctype = r.headers.get("content-type", "")
        check("download all content-type application/zip", "application/zip" in ctype, ctype)
        cd = r.headers.get("content-disposition", "")
        check("download all content-disposition has attachment+filename",
              "attachment" in cd.lower() and "filename" in cd.lower(), cd)
        try:
            zf = zipfile.ZipFile(io.BytesIO(r.content))
            namelist = zf.namelist()
            check(f"download zip has {len(jpgs)} files", len(namelist) == len(jpgs), str(namelist))
        except Exception as exc:
            check("download zip valid", False, str(exc))

    if len(photo_ids) >= 2:
        ids_csv = ",".join(photo_ids[:2])
        r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/download?ids={ids_csv}",
                         headers=hdr(admin_tok), timeout=60)
        check("download multi-csv -> 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            check("download multi content-type zip",
                  "application/zip" in r.headers.get("content-type", ""),
                  r.headers.get("content-type"))

    # STEP 9: Upload + delete single
    print("\n=== STEP 9: Upload + delete single ===")
    uploaded_id = None
    if jpgs:
        with open(jpgs[0], "rb") as f:
            files = {"file": (f"upload_{uuid.uuid4().hex[:6]}.jpg", f, "image/jpeg")}
            r = requests.post(
                f"{BASE}/admin/weddings/{wedding_id}/photos/upload",
                headers=hdr(admin_tok),
                files=files,
                timeout=60,
            )
        check("upload admin -> 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            data = r.json()
            for k in ("id", "filename", "thumb_url", "full_url"):
                check(f"upload response has {k}", k in data, str(data))
            uploaded_id = data.get("id")

        with open(jpgs[0], "rb") as f:
            files = {"file": ("bad.jpg", f, "image/jpeg")}
            r = requests.post(
                f"{BASE}/admin/weddings/{wedding_id}/photos/upload",
                headers=hdr(free_tok),
                files=files,
                timeout=30,
            )
        check("upload non-admin -> 403", r.status_code == 403, f"{r.status_code}")

        if uploaded_id:
            r = requests.delete(
                f"{BASE}/admin/weddings/{wedding_id}/photos/{uploaded_id}",
                headers=hdr(admin_tok), timeout=30,
            )
            check("delete single -> 200", r.status_code == 200, f"{r.status_code}")
            r = requests.delete(
                f"{BASE}/admin/weddings/{wedding_id}/photos/__nope__",
                headers=hdr(admin_tok), timeout=30,
            )
            check("delete non-existent -> 404", r.status_code == 404, f"{r.status_code}")

    # STEP 10: Music
    print("\n=== STEP 10: Music upload/delete ===")
    dummy_mp3 = b"ID3\x04\x00\x00\x00\x00\x00\x21TSSE\x00\x00\x00\x0f\x00\x00\x03Lavf58.29.100\x00" + (b"\x00" * 256)
    files = {"file": ("test_music.mp3", io.BytesIO(dummy_mp3), "audio/mpeg")}
    r = requests.post(
        f"{BASE}/admin/weddings/{wedding_id}/music",
        headers=hdr(admin_tok), files=files, timeout=30,
    )
    check("music upload -> 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        data = r.json()
        check("music upload ok=true", data.get("ok") is True, str(data))
        check("music_url set", "music_url" in data, str(data))
        check("music_url starts /api/uploads/photos/",
              data.get("music_url", "").startswith("/api/uploads/photos/"))

    r = requests.get(f"{BASE}/admin/weddings/{wedding_id}/photos/stats",
                     headers=hdr(admin_tok), timeout=30)
    if r.status_code == 200:
        sd = r.json()
        check("stats.music_filename == music.mp3", sd.get("music_filename") == "music.mp3", str(sd))
        check("stats.music_size > 0", (sd.get("music_size") or 0) > 0, str(sd))

    r = requests.get(f"{BASE}/weddings/{wedding_id}/photos/info",
                     headers=hdr(admin_tok), timeout=30)
    if r.status_code == 200:
        data = r.json()
        check("info.music_url set", data.get("music_url") is not None, str(data))

    # bad ext
    files = {"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")}
    r = requests.post(
        f"{BASE}/admin/weddings/{wedding_id}/music",
        headers=hdr(admin_tok), files=files, timeout=30,
    )
    check("music upload bad ext -> 400", r.status_code == 400, f"{r.status_code}")

    files = {"file": ("test.mp3", io.BytesIO(dummy_mp3), "audio/mpeg")}
    r = requests.post(
        f"{BASE}/admin/weddings/{wedding_id}/music",
        headers=hdr(free_tok), files=files, timeout=30,
    )
    check("music upload non-admin -> 403", r.status_code == 403, f"{r.status_code}")

    r = requests.delete(
        f"{BASE}/admin/weddings/{wedding_id}/music",
        headers=hdr(admin_tok), timeout=30,
    )
    check("music delete -> 200", r.status_code == 200, f"{r.status_code}")

    r = requests.get(f"{BASE}/admin/weddings/{wedding_id}/photos/stats",
                     headers=hdr(admin_tok), timeout=30)
    if r.status_code == 200:
        sd = r.json()
        check("stats.music_filename None after delete", sd.get("music_filename") is None, str(sd))

    # STEP 11: 404 paths
    print("\n=== STEP 11: 404 paths ===")
    r = requests.post(
        f"{BASE}/admin/weddings/__no__no__no__/photos/scan",
        headers=hdr(admin_tok), timeout=30,
    )
    check("scan nonexistent wedding -> 404", r.status_code == 404, f"{r.status_code}")

    r = requests.post(
        f"{BASE}/admin/weddings/__no__/music",
        headers=hdr(admin_tok),
        files={"file": ("x.mp3", io.BytesIO(dummy_mp3), "audio/mpeg")},
        timeout=30,
    )
    check("music nonexistent wedding -> 404", r.status_code == 404, f"{r.status_code}")

    # STEP 12: Bulk delete
    print("\n=== STEP 12: Bulk delete ===")
    r = requests.delete(
        f"{BASE}/admin/weddings/{wedding_id}/photos",
        headers=hdr(admin_tok), timeout=30,
    )
    check("bulk delete admin -> 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        check("bulk delete ok=true", r.json().get("ok") is True, str(r.json()))

    r = requests.delete(
        f"{BASE}/admin/weddings/{wedding_id}/photos",
        headers=hdr(free_tok), timeout=30,
    )
    check("bulk delete non-admin -> 403", r.status_code == 403, f"{r.status_code}")

    r = requests.get(f"{BASE}/admin/weddings/{wedding_id}/photos/stats",
                     headers=hdr(admin_tok), timeout=30)
    if r.status_code == 200:
        sd = r.json()
        check("stats.photos_count == 0 after bulk", sd.get("photos_count") == 0, str(sd))

    # STEP 13: Smoke regression
    print("\n=== STEP 13: Smoke regression ===")
    r = requests.get(f"{BASE}/auth/me", headers=hdr(admin_tok), timeout=30)
    check("regression /auth/me admin -> 200", r.status_code == 200, f"{r.status_code}")
    r = requests.get(f"{BASE}/weddings/public", timeout=30)
    check("regression /weddings/public -> 200", r.status_code == 200, f"{r.status_code}")
    r = requests.get(f"{BASE}/admin/users", headers=hdr(admin_tok), timeout=30)
    check("regression /admin/users -> 200", r.status_code == 200, f"{r.status_code}")

    payload = {"subject": "Photo gallery smoke test", "initial_message": "smoke test"}
    r = requests.post(f"{BASE}/support/tickets", headers=hdr(admin_tok), json=payload, timeout=30)
    check("regression POST /support/tickets -> 200", r.status_code == 200, f"{r.status_code}")
    created_ticket = r.json().get("id") if r.status_code == 200 else None

    # CLEANUP
    print("\n=== CLEANUP ===")
    r = requests.delete(f"{BASE}/admin/weddings/{wedding_id}/photos", headers=hdr(admin_tok), timeout=30)
    print(f"  cleanup bulk delete photos -> {r.status_code}")
    r = requests.delete(f"{BASE}/admin/weddings/{wedding_id}/music", headers=hdr(admin_tok), timeout=30)
    print(f"  cleanup music delete -> {r.status_code}")
    if base_dir.exists():
        shutil.rmtree(base_dir)
        print(f"  removed {base_dir}")
    if created_ticket:
        r = requests.delete(f"{BASE}/admin/support/tickets/{created_ticket}", headers=hdr(admin_tok), timeout=30)
        print(f"  cleanup support ticket -> {r.status_code}")

    print(f"\n=== TOTAL: {PASS} passed, {FAIL} failed ===")
    if FAILURES:
        print("\nFailures:")
        for f in FAILURES:
            print(f"  - {f}")
    return 0 if FAIL == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
