"""
Test admin login on PRODUCTION (cinemaries.fr) after password reset + 2FA disable.

Context:
- Admin contact@cinemaries.fr had 2FA (email) enabled but SMTP was blocked.
- Main agent reset password to Reset2026! via bcrypt direct + disabled 2FA in DB.
- These tests validate the fix end-to-end via HTTPS on prod.
"""
import pytest
import requests

PROD_URL = "https://cinemaries.fr"
ADMIN_EMAIL = "contact@cinemaries.fr"
INITIAL_PASSWORD = "Reset2026!"
NEW_PASSWORD = "Reset2026New!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Shared state across tests in this module
state = {"access_token": None}


# ---------- Test 1: login without 2FA ----------
class TestLoginNo2FA:
    def test_login_returns_200_with_access_token(self, session):
        r = session.post(
            f"{PROD_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": INITIAL_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "access_token" in data, f"access_token missing in response: {data}"
        assert data.get("requires_2fa") is not True, f"requires_2fa should NOT be true: {data}"
        # User payload checks
        user = data.get("user") or {}
        assert user.get("is_admin") is True, f"user.is_admin must be true: {user}"
        assert user.get("is_active") is True, f"user.is_active must be true: {user}"
        state["access_token"] = data["access_token"]


# ---------- Test 2: token grants access to admin/user endpoints ----------
class TestTokenAccess:
    def test_auth_me_with_token(self, session):
        assert state["access_token"], "Missing token from Test 1"
        r = session.get(
            f"{PROD_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {state['access_token']}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/auth/me failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("email") == ADMIN_EMAIL or (data.get("user") or {}).get("email") == ADMIN_EMAIL, f"Unexpected /me payload: {data}"

    def test_2fa_status_is_disabled(self, session):
        assert state["access_token"], "Missing token from Test 1"
        r = session.get(
            f"{PROD_URL}/api/auth/2fa/status",
            headers={"Authorization": f"Bearer {state['access_token']}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/2fa/status failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("enabled") is False, f"2FA should be disabled: {data}"


# ---------- Test 3: change-password endpoint works ----------
class TestChangePassword:
    def test_change_password_ok(self, session):
        assert state["access_token"], "Missing token from Test 1"
        r = session.post(
            f"{PROD_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {state['access_token']}"},
            json={"current_password": INITIAL_PASSWORD, "new_password": NEW_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"change-password failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok") is True, f"Response should contain ok=true: {data}"


# ---------- Test 4: new password works, old is rejected ----------
class TestNewPasswordEffective:
    def test_login_with_new_password_succeeds(self, session):
        r = session.post(
            f"{PROD_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": NEW_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"Login with new password failed: {r.status_code} {r.text}"
        data = r.json()
        assert "access_token" in data, f"Missing access_token: {data}"
        assert data.get("requires_2fa") is not True
        state["access_token"] = data["access_token"]

    def test_login_with_old_password_rejected(self, session):
        r = session.post(
            f"{PROD_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": INITIAL_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 401, f"Old password should be rejected with 401, got {r.status_code}: {r.text}"


# ---------- Test 5: revert password back to Reset2026! ----------
class TestRevertPassword:
    def test_revert_to_initial(self, session):
        assert state["access_token"], "Missing token from Test 4"
        r = session.post(
            f"{PROD_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {state['access_token']}"},
            json={"current_password": NEW_PASSWORD, "new_password": INITIAL_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"revert change-password failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok") is True, f"Response should contain ok=true: {data}"

    def test_login_with_initial_password_again(self, session):
        r = session.post(
            f"{PROD_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": INITIAL_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"Final login with Reset2026! failed: {r.status_code} {r.text}"
        assert "access_token" in r.json()
