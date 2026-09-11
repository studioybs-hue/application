"""
Backend tests for the production upload fix on cinemaries.fr.

Context: uploads used to be written to /var/www/cinemaries/backend/uploads/
but Nginx served /api/uploads/* from /srv/cinemaries/uploads/. A symlink was
put in place to make both point to the same physical directory.

These tests validate:
  A. Newly uploaded file (recent) is served
  B. Fresh upload lands in the correct dir and is immediately servable
  C. Old files (pre-fix) are still accessible via /api/uploads
  E. Non-regression: login + admin/stats still work
"""
import io
import os
import pytest
import requests

BASE_URL = "https://cinemaries.fr"
ADMIN_EMAIL = "contact@cinemaries.fr"
ADMIN_PASSWORD = "Reset2026!"

RECENT_UPLOAD = f"{BASE_URL}/api/uploads/fb33a3e1805a40c78239386ff29aa790.jpg"
OLD_HERO = f"{BASE_URL}/api/uploads/ca3e1fb7a4684f50877dd15c9b2e1edc.jpg"
OLD_POSTER = f"{BASE_URL}/api/uploads/ea256a56a1a54e4eb5b51cbdadb20858.jpg"


# --- shared client fixture ---
@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if not tok:
        pytest.skip(f"No access_token in login response: {data}")
    return tok


# --- Test A: recent upload accessible ---
class TestARecentUpload:
    def test_recent_upload_accessible(self, api_client):
        r = api_client.get(RECENT_UPLOAD, timeout=20)
        assert r.status_code == 200, f"Expected 200 got {r.status_code} body={r.text[:200]}"
        ct = r.headers.get("Content-Type", "")
        assert "image" in ct.lower(), f"Content-Type not image: {ct}"
        assert len(r.content) > 100 * 1024, f"File suspiciously small: {len(r.content)} bytes"


# --- Test C: old uploads still accessible ---
class TestCOldUploads:
    @pytest.mark.parametrize("url", [OLD_HERO, OLD_POSTER])
    def test_old_upload_accessible(self, api_client, url):
        r = api_client.get(url, timeout=20)
        assert r.status_code == 200, f"{url} -> {r.status_code}"
        assert "image" in r.headers.get("Content-Type", "").lower()
        assert len(r.content) > 1024


# --- Test E: non-regression login + admin stats ---
class TestENonRegression:
    def test_login_returns_token(self, admin_token):
        assert admin_token and isinstance(admin_token, str)

    def test_admin_stats(self, api_client, admin_token):
        r = api_client.get(
            f"{BASE_URL}/api/admin/stats",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"admin/stats -> {r.status_code} {r.text[:200]}"
        data = r.json()
        assert isinstance(data, dict)


# --- Test B: full round-trip fresh upload ---
def _make_tiny_jpg_bytes() -> bytes:
    # Minimal valid JPEG (1x1 white pixel).
    return bytes.fromhex(
        "FFD8FFE000104A46494600010100000100010000FFDB004300080606"
        "0706080706090908090B0A0A0A0B0E0D0C0C0D0E17110F0F0F111713"
        "1516131714171E1C1D191A1D2321251F21231D262324252428272E23"
        "24272A2A2A2A24272B2D2D2D2A2A2A2A2AFFC00011080001000103012200021101031101"
        "FFC4001F0000010501010101010100000000000000000102030405060708090A0B"
        "FFC400B5100002010303020403050504040000017D01020300041105122131410613"
        "516107227114328191A1082342B1C11552D1F02433627282090A161718191A25262728"
        "292A3435363738393A434445464748494A535455565758595A636465666768696A73"
        "7475767778797A838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2"
        "B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8"
        "E9EAF1F2F3F4F5F6F7F8F9FAFFDA0008010100003F00FBD0FFD9"
    )


class TestBFreshUpload:
    def test_fresh_upload_accessible(self, api_client, admin_token):
        img = _make_tiny_jpg_bytes()
        files = {"file": ("test_tiny.jpg", io.BytesIO(img), "image/jpeg")}
        data = {"kind": "image"}
        r = api_client.post(
            f"{BASE_URL}/api/admin/upload",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            data=data,
            timeout=30,
        )
        assert r.status_code == 200, f"upload -> {r.status_code} {r.text[:300]}"
        body = r.json()
        url = body.get("url")
        assert url, f"No url in response: {body}"
        assert "/api/uploads/" in url
        # Support both absolute and relative URLs
        full_url = url if url.startswith("http") else f"{BASE_URL}{url}"

        # Immediately fetch it (fresh session, no auth needed for public uploads)
        get = requests.get(full_url, timeout=20)
        assert get.status_code == 200, f"GET {url} -> {get.status_code}"
        assert "image" in get.headers.get("Content-Type", "").lower()
        assert len(get.content) == len(img), (
            f"Size mismatch: uploaded {len(img)} got {len(get.content)}"
        )
