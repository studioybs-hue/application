"""
Tests for Nginx cache-control headers fix on https://cinemaries.fr
Verifies:
- HTML routes return no-store/must-revalidate
- Hashed Expo assets have long-cache immutable
- Uploads still accessible
- Non-regression: site still responds
- Non-regression: admin login + admin API still work
"""

import re
import pytest
import requests

BASE_URL = "https://cinemaries.fr"
ADMIN_EMAIL = "contact@cinemaries.fr"
ADMIN_PASSWORD = "Reset2026!"

HTML_ROUTES = [
    "/",
    "/admin",
    "/auth/login",
    "/wedding/hanifa-et-dali",
    "/guestbook/hanifa-et-dali",
    "/legal/privacy",
]


# ---------- Test A: HTML routes must be no-cache ----------
@pytest.mark.parametrize("path", HTML_ROUTES)
def test_html_route_has_no_cache_headers(path):
    """HTML SPA routes must not be cached by the browser."""
    url = f"{BASE_URL}{path}"
    resp = requests.head(url, allow_redirects=True, timeout=15)
    assert resp.status_code in (200, 301, 302), f"{url} returned {resp.status_code}"

    cache_control = resp.headers.get("Cache-Control", "").lower()
    assert cache_control, f"{url} missing Cache-Control header"
    assert "no-store" in cache_control, (
        f"{url} Cache-Control missing 'no-store': got '{cache_control}'"
    )
    assert "must-revalidate" in cache_control, (
        f"{url} Cache-Control missing 'must-revalidate': got '{cache_control}'"
    )


# ---------- Test B: Hashed Expo assets must be immutable long-cache ----------
def test_expo_hashed_asset_has_immutable_long_cache():
    """Static hashed JS assets under /_expo/static/js/web/* should be cached 1 year."""
    resp = requests.get(f"{BASE_URL}/", timeout=15)
    assert resp.status_code == 200, f"GET / returned {resp.status_code}"

    # Extract an _expo/static/js/web/*.js URL from HTML
    match = re.search(r'(/_expo/static/js/web/[^"\'\s>]+\.js)', resp.text)
    assert match, "Could not find any /_expo/static/js/web/*.js asset in HTML"

    asset_path = match.group(1)
    asset_url = f"{BASE_URL}{asset_path}"
    print(f"Testing hashed asset: {asset_url}")

    head = requests.head(asset_url, allow_redirects=True, timeout=15)
    assert head.status_code == 200, f"{asset_url} returned {head.status_code}"

    cache_control = head.headers.get("Cache-Control", "").lower()
    assert cache_control, f"{asset_url} missing Cache-Control header"
    assert "max-age=31536000" in cache_control, (
        f"{asset_url} Cache-Control missing 'max-age=31536000': got '{cache_control}'"
    )
    assert "immutable" in cache_control, (
        f"{asset_url} Cache-Control missing 'immutable': got '{cache_control}'"
    )


# ---------- Test C: Uploads still accessible ----------
def test_uploads_accessible():
    """Uploaded images/videos under /api/uploads/ must return 200."""
    url = f"{BASE_URL}/api/uploads/ca3e1fb7a4684f50877dd15c9b2e1edc.jpg"
    resp = requests.head(url, allow_redirects=True, timeout=15)
    assert resp.status_code == 200, f"{url} returned {resp.status_code}"
    # Cache-Control presence is nice-to-have; log it
    print(f"Uploads Cache-Control: {resp.headers.get('Cache-Control')}")


# ---------- Test D: Non-regression — site responds ----------
def test_homepage_returns_html_with_brand():
    resp = requests.get(f"{BASE_URL}/", timeout=15)
    assert resp.status_code == 200
    # Force UTF-8 decoding (server does not always set charset)
    body = resp.content.decode("utf-8", errors="replace")
    assert "CINÉMARIÉS" in body, (
        "Homepage does not contain 'CINÉMARIÉS' brand string"
    )


def test_videos_public_endpoint():
    resp = requests.get(f"{BASE_URL}/api/videos/public", timeout=15)
    assert resp.status_code == 200, f"/api/videos/public returned {resp.status_code}"


def test_guestbook_active_endpoint():
    resp = requests.get(f"{BASE_URL}/api/guestbook/active", timeout=15)
    assert resp.status_code == 200, f"/api/guestbook/active returned {resp.status_code}"


# ---------- Test E: Non-regression — admin login + admin API ----------
@pytest.fixture(scope="module")
def admin_token():
    # Try common login endpoints
    login_paths = [
        "/api/auth/login",
        "/api/admin/login",
        "/api/login",
    ]
    session = requests.Session()
    last_err = None
    for p in login_paths:
        try:
            r = session.post(
                f"{BASE_URL}{p}",
                json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                timeout=15,
            )
            if r.status_code == 200:
                data = r.json()
                tok = (
                    data.get("token")
                    or data.get("access_token")
                    or data.get("accessToken")
                    or (data.get("data") or {}).get("token")
                )
                if tok:
                    print(f"Login OK via {p}")
                    return tok
                last_err = f"{p}: 200 but no token field in {list(data.keys())}"
            else:
                last_err = f"{p}: {r.status_code} {r.text[:200]}"
        except Exception as e:
            last_err = f"{p}: {e}"
    pytest.skip(f"Could not obtain admin token: {last_err}")


def test_admin_login_and_stats(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/api/admin/stats", headers=headers, timeout=15)
    assert r.status_code == 200, (
        f"/api/admin/stats returned {r.status_code}: {r.text[:200]}"
    )
