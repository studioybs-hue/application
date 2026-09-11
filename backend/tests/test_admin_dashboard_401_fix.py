"""
Backend tests for the admin dashboard "infinite spinner" fix.

Context:
- Fix targets production https://cinemaries.fr and the /api/admin/stats endpoint.
- Frontend now handles 401 globally; backend behaviour should be:
  * invalid token -> 401
  * valid admin token -> 200 with dashboard payload
  * valid non-admin token -> 403 (must NOT expose stats)
  * token must work across /admin/stats, /auth/me, /auth/2fa/status
- Also verifies nginx redirect from cinemaries.com -> https://cinemaries.fr.
"""
import pytest
import requests

PROD_URL = "https://cinemaries.fr"
ADMIN_EMAIL = "contact@cinemaries.fr"
ADMIN_PASSWORD = "Reset2026!"
CLIENT_EMAIL = "test@wedding.fr"
CLIENT_PASSWORD = "test1234"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(
        f"{PROD_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data, f"Missing access_token: {data}"
    assert data.get("requires_2fa") is not True, f"2FA should NOT be required: {data}"
    return data["access_token"]


@pytest.fixture(scope="module")
def client_token(session):
    r = session.post(
        f"{PROD_URL}/api/auth/login",
        json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Client login failed ({r.status_code}): {r.text}")
    data = r.json()
    if "access_token" not in data:
        pytest.skip(f"Client login response missing access_token: {data}")
    return data["access_token"]


# ---------- Test 1: invalid token -> 401 on /admin/stats ----------
class TestInvalidTokenReturns401:
    def test_invalid_token_401(self, session):
        r = session.get(
            f"{PROD_URL}/api/admin/stats",
            headers={"Authorization": "Bearer invalid_token_xyz"},
            timeout=15,
        )
        assert r.status_code == 401, (
            f"Expected 401 for invalid token, got {r.status_code}: {r.text}"
        )

    def test_missing_token_returns_401_or_403(self, session):
        r = session.get(f"{PROD_URL}/api/admin/stats", timeout=15)
        assert r.status_code in (401, 403), (
            f"Expected 401/403 without token, got {r.status_code}: {r.text}"
        )


# ---------- Test 2: valid admin token -> 200 with expected payload ----------
class TestAdminStatsWithValidToken:
    EXPECTED_KEYS = {"users", "premium", "videos", "codes_total"}

    def test_admin_stats_200(self, session, admin_token):
        r = session.get(
            f"{PROD_URL}/api/admin/stats",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, (
            f"/admin/stats failed: {r.status_code} {r.text}"
        )
        data = r.json()
        assert isinstance(data, dict), f"Response should be a dict: {data}"
        missing = self.EXPECTED_KEYS - set(data.keys())
        assert not missing, f"/admin/stats missing keys {missing}. Got: {data}"
        # sanity: counts should be int-like non-negative
        for k in self.EXPECTED_KEYS:
            v = data.get(k)
            assert isinstance(v, int), f"{k} should be int, got {type(v).__name__}={v!r}"
            assert v >= 0, f"{k} should be >= 0, got {v}"


# ---------- Test 3: same admin token works on multiple protected endpoints ----------
class TestAdminTokenAcrossEndpoints:
    def test_auth_me(self, session, admin_token):
        r = session.get(
            f"{PROD_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/auth/me failed: {r.status_code} {r.text}"
        data = r.json()
        email = data.get("email") or (data.get("user") or {}).get("email")
        assert email == ADMIN_EMAIL, f"Unexpected /me payload: {data}"

    def test_2fa_status_disabled(self, session, admin_token):
        r = session.get(
            f"{PROD_URL}/api/auth/2fa/status",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/2fa/status failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("enabled") is False, f"2FA should be disabled: {data}"


# ---------- Test 4: non-admin client token -> 403 on /admin/stats ----------
class TestNonAdminForbidden:
    def test_client_cannot_access_admin_stats(self, session, client_token):
        r = session.get(
            f"{PROD_URL}/api/admin/stats",
            headers={"Authorization": f"Bearer {client_token}"},
            timeout=15,
        )
        assert r.status_code == 403, (
            f"Non-admin should be forbidden with 403, got {r.status_code}: {r.text}"
        )


# ---------- Test 5: nginx redirect cinemaries.com -> https://cinemaries.fr ----------
class TestNginxRedirect:
    def test_com_to_fr_redirect(self):
        # Follow redirects; verify final URL is on cinemaries.fr AND that at least
        # one hop is a 301 to https://cinemaries.fr
        try:
            r = requests.get("http://cinemaries.com/", allow_redirects=True, timeout=20)
        except requests.RequestException as e:
            pytest.skip(f"cinemaries.com not reachable from test host: {e}")

        # Final URL must be under cinemaries.fr
        assert "cinemaries.fr" in r.url, (
            f"Final URL should be on cinemaries.fr, got: {r.url}"
        )

        # Inspect history for the redirect
        chain = [(h.status_code, h.headers.get("Location", "")) for h in r.history]
        chain.append((r.status_code, r.url))
        has_permanent_redirect_to_fr = any(
            code == 301 and "cinemaries.fr" in loc
            for code, loc in chain
        )
        assert has_permanent_redirect_to_fr, (
            f"Expected a 301 -> https://cinemaries.fr somewhere in the chain. Chain: {chain}"
        )
