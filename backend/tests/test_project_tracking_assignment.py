"""
Backend tests for the "Admin -> Client project tracking assignment" bug fix.

Scenarios (per review_request):
  A. /api/projects/me returns the project for a user whose users.client_id is set
     directly (no wedding_claims doc). Must NOT be null.
  B. /api/guestbook/mine returns wedding vows linked via client_id.
  C. Admin can list / read projects (attribute suivi).
  D. A user WITHOUT client_id / claim receives {"project": null} (no crash).
  E. Admin without claim receives the first project as admin_preview=True.

Uses the production URL as it is the environment where the fix is deployed
(per credentials file). If admin login on prod fails (e.g. temp pw rotated),
falls back to internal EXPO_BACKEND_URL.
"""
import os
import uuid
import pytest
import requests

PROD_URL = "https://cinemaries.fr"
INTERNAL_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or PROD_URL
).rstrip("/")

ADMIN_EMAIL = "contact@cinemaries.fr"
ADMIN_PASSWORD = "Reset2026!"
CLIENT_EMAIL = "test@wedding.fr"
CLIENT_PASSWORD = "test1234"
EXPECTED_CLIENT_ID = "hanifa-et-dali"


def _login(base_url, email, password):
    r = requests.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    return r


@pytest.fixture(scope="module")
def base_url():
    # Prefer prod because that's where the fix is deployed & the seeded data lives.
    r = _login(PROD_URL, ADMIN_EMAIL, ADMIN_PASSWORD)
    if r.status_code == 200 and "access_token" in r.json():
        return PROD_URL
    # Fallback: internal preview
    return INTERNAL_URL


@pytest.fixture(scope="module")
def admin_token(base_url):
    r = _login(base_url, ADMIN_EMAIL, ADMIN_PASSWORD)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed on {base_url}: {r.status_code} {r.text}")
    data = r.json()
    if "access_token" not in data:
        pytest.skip(f"Admin login response missing token: {data}")
    return data["access_token"]


@pytest.fixture(scope="module")
def client_token(base_url):
    r = _login(base_url, CLIENT_EMAIL, CLIENT_PASSWORD)
    if r.status_code != 200:
        pytest.skip(f"Client login failed on {base_url}: {r.status_code} {r.text}")
    data = r.json()
    if "access_token" not in data:
        pytest.skip(f"Client login response missing token: {data}")
    return data["access_token"]


# --------------------------------------------------------------------------
# Test A — /api/projects/me for a user with direct client_id (no claim)
# --------------------------------------------------------------------------
class TestProjectsMeDirectAssignment:
    def test_projects_me_returns_project(self, base_url, client_token):
        r = requests.get(
            f"{base_url}/api/projects/me",
            headers={"Authorization": f"Bearer {client_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/projects/me failed: {r.status_code} {r.text}"
        data = r.json()
        assert "project" in data, f"Missing 'project' key: {data}"
        project = data.get("project")
        assert project is not None, (
            "REGRESSION: /projects/me returned project=null for a user with "
            f"direct users.client_id set. Response: {data}"
        )
        assert project.get("client_id") == EXPECTED_CLIENT_ID, (
            f"Wrong client_id: expected {EXPECTED_CLIENT_ID}, got {project.get('client_id')}"
        )

    def test_projects_me_wedding_name(self, base_url, client_token):
        r = requests.get(
            f"{base_url}/api/projects/me",
            headers={"Authorization": f"Bearer {client_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        project = r.json().get("project") or {}
        # Accept "Hanifa & Dali" or any title-cased variant
        wn = (project.get("wedding_name") or "").lower()
        assert "hanifa" in wn and "dali" in wn, (
            f"wedding_name should mention Hanifa & Dali, got: {project.get('wedding_name')!r}"
        )

    def test_projects_me_has_9_steps(self, base_url, client_token):
        r = requests.get(
            f"{base_url}/api/projects/me",
            headers={"Authorization": f"Bearer {client_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        project = r.json().get("project") or {}
        steps = project.get("steps")
        assert isinstance(steps, list), f"steps should be a list, got {type(steps).__name__}"
        assert len(steps) == 9, f"Expected 9 tracking steps, got {len(steps)}: {steps}"
        # each step must have key/title/status
        for s in steps:
            assert {"key", "title", "status"} <= set(s.keys()), f"Step malformed: {s}"


# --------------------------------------------------------------------------
# Test B — /api/guestbook/mine
# --------------------------------------------------------------------------
class TestGuestbookMine:
    def test_guestbook_mine_returns_items(self, base_url, client_token):
        r = requests.get(
            f"{base_url}/api/guestbook/mine",
            headers={"Authorization": f"Bearer {client_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/guestbook/mine failed: {r.status_code} {r.text}"
        data = r.json()
        # Endpoint contract per review_request
        assert data.get("client_id") == EXPECTED_CLIENT_ID, (
            f"Wrong client_id: expected {EXPECTED_CLIENT_ID}, got {data.get('client_id')}"
        )
        assert isinstance(data.get("items"), list), (
            f"items should be a list, got {type(data.get('items')).__name__}"
        )
        count = data.get("count")
        # If the response doesn't include count, derive it from items
        if count is None:
            count = len(data.get("items", []))
        assert count >= 3, f"Expected at least 3 vows, got {count}. Items: {data.get('items')}"


# --------------------------------------------------------------------------
# Test C — Admin can list & read projects
# --------------------------------------------------------------------------
class TestAdminProjectListing:
    def test_admin_list_projects(self, base_url, admin_token):
        r = requests.get(
            f"{base_url}/api/admin/projects",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/admin/projects failed: {r.status_code} {r.text}"
        data = r.json()
        assert "items" in data, f"Missing items: {data}"
        items = data["items"]
        assert isinstance(items, list) and len(items) >= 1, f"No project items: {data}"
        client_ids = {p.get("client_id") for p in items}
        assert EXPECTED_CLIENT_ID in client_ids, (
            f"Expected project '{EXPECTED_CLIENT_ID}' in admin listing, got {client_ids}"
        )

    def test_admin_get_specific_project(self, base_url, admin_token):
        r = requests.get(
            f"{base_url}/api/admin/projects/{EXPECTED_CLIENT_ID}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, (
            f"/admin/projects/{EXPECTED_CLIENT_ID} failed: {r.status_code} {r.text}"
        )
        p = r.json()
        assert p.get("client_id") == EXPECTED_CLIENT_ID
        steps = p.get("steps") or []
        assert len(steps) == 9, f"Project should have 9 steps, got {len(steps)}"


# --------------------------------------------------------------------------
# Test D — User without client_id/claim → {project: null}
# --------------------------------------------------------------------------
class TestProjectsMeNullForUnclaimed:
    """Create an ephemeral user via /auth/register, then hit /projects/me.

    If registration is disabled/gated we skip.
    """

    @pytest.fixture(scope="class")
    def orphan_token(self, base_url):
        email = f"orphan-{uuid.uuid4().hex[:8]}@wedding-test.fr"
        pw = "Orphan1234!"
        payload_variants = [
            {"email": email, "password": pw, "full_name": "Orphan Test"},
            {"email": email, "password": pw, "name": "Orphan Test"},
            {"email": email, "password": pw},
        ]
        last_resp = None
        for payload in payload_variants:
            r = requests.post(
                f"{base_url}/api/auth/register",
                json=payload,
                timeout=15,
            )
            last_resp = r
            if r.status_code in (200, 201):
                data = r.json()
                tok = data.get("access_token") or (data.get("token") if isinstance(data, dict) else None)
                if tok:
                    return tok
                # need to login
                lr = _login(base_url, email, pw)
                if lr.status_code == 200 and "access_token" in lr.json():
                    return lr.json()["access_token"]
        pytest.skip(
            f"Cannot create ephemeral user for orphan test "
            f"(last status={last_resp.status_code if last_resp else 'n/a'})"
        )

    def test_projects_me_null(self, base_url, orphan_token):
        r = requests.get(
            f"{base_url}/api/projects/me",
            headers={"Authorization": f"Bearer {orphan_token}"},
            timeout=15,
        )
        assert r.status_code == 200, (
            f"/projects/me must return 200 even without link, got {r.status_code}: {r.text}"
        )
        data = r.json()
        assert data.get("project") is None, (
            f"Orphan user should get project=null, got: {data}"
        )


# --------------------------------------------------------------------------
# Test E — Admin without claim → admin_preview=True with a project
# --------------------------------------------------------------------------
class TestAdminPreview:
    def test_admin_projects_me_preview(self, base_url, admin_token):
        r = requests.get(
            f"{base_url}/api/projects/me",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/projects/me admin failed: {r.status_code} {r.text}"
        data = r.json()
        # Admin should either be linked to a real wedding (unlikely) or receive admin_preview.
        assert data.get("project") is not None, (
            f"Admin should always see a project preview, got: {data}"
        )
        # If the admin user has NO client_id, admin_preview must be True.
        # We cannot introspect their users.client_id, so accept either:
        # - admin_preview=True (unclaimed admin — expected case), OR
        # - a specific project linked (edge case if admin was also assigned).
        if not data.get("admin_preview"):
            # then they must have a direct client_id/claim — at minimum verify project has steps
            steps = (data.get("project") or {}).get("steps") or []
            assert len(steps) == 9, (
                f"Admin project without admin_preview should still have 9 steps, got {len(steps)}. Resp: {data}"
            )
        else:
            assert data.get("admin_preview") is True
