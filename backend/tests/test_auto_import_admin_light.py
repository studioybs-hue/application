"""Light admin-facing tests for the auto-import feature.

These tests intentionally do NOT drop files into ftp_drop/ (heavy pipeline
already covered by auto_import_e2e.py). Focus is only on the admin HTTP
endpoints used by the frontend `/admin/auto-import` screen.
"""
import os
import copy
import requests
import pytest

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://mariagevideo.preview.emergentagent.com"
).rstrip("/")

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@wedding.fr")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "Admin13!")
USER_EMAIL = "test@wedding.fr"
USER_PWD = "test1234"


# ---------- fixtures ---------- #
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PWD}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"free user login failed: {r.status_code} {r.text}")
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


# ---------- stats ---------- #
def test_stats_admin(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/stats", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ("pending", "processed", "errors", "duplicates", "watcher_running"):
        assert k in j, f"missing {k}"
    assert j["watcher_running"] is True
    assert isinstance(j["processed"], int)
    assert isinstance(j["errors"], int)


def test_stats_forbidden_for_user(user_headers):
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/stats", headers=user_headers, timeout=15)
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_stats_forbidden_no_auth():
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/stats", timeout=15)
    assert r.status_code in (401, 403)


# ---------- jobs ---------- #
@pytest.mark.parametrize("status_val", ["all", "PROCESSED", "ERROR", "PENDING"])
def test_jobs_list(admin_headers, status_val):
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/jobs", params={"status": status_val}, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "items" in j and "count" in j
    assert isinstance(j["items"], list)
    assert j["count"] == len(j["items"])
    if status_val not in ("all",) and j["items"]:
        for it in j["items"]:
            assert it["status"] == status_val, f"filter {status_val} returned status={it['status']}"


def test_jobs_forbidden_for_user(user_headers):
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/jobs", headers=user_headers, timeout=15)
    assert r.status_code == 403


# ---------- settings ---------- #
def test_settings_get(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "services" in j and isinstance(j["services"], list) and j["services"]
    for s in j["services"]:
        assert "key" in s and "label" in s and "category" in s
    assert "categories" in j and isinstance(j["categories"], list) and j["categories"]
    for k in ("enabled", "default_featured", "default_showcase"):
        assert k in j


def test_settings_put_add_and_remove_brunch(admin_headers):
    """Add 'brunch' service, verify persisted+normalized, then restore original list."""
    original = requests.get(f"{BASE_URL}/api/admin/auto-import/settings", headers=admin_headers, timeout=15).json()
    original_services = copy.deepcopy(original["services"])

    new_services = original_services + [{"key": "BRUNCH", "label": "Brunch", "category": "Soirées"}]
    body = {
        "enabled": original["enabled"],
        "default_featured": original["default_featured"],
        "default_showcase": original["default_showcase"],
        "services": new_services,
    }
    r = requests.put(f"{BASE_URL}/api/admin/auto-import/settings", json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    keys = [s["key"] for s in j["services"]]
    assert "brunch" in keys, f"'brunch' not normalized/persisted, got keys={keys}"
    brunch = next(s for s in j["services"] if s["key"] == "brunch")
    assert brunch["category"] == "Soirées"

    # Verify persistence via GET
    r2 = requests.get(f"{BASE_URL}/api/admin/auto-import/settings", headers=admin_headers, timeout=15)
    assert r2.status_code == 200
    assert "brunch" in [s["key"] for s in r2.json()["services"]]

    # Restore
    restore = {"services": original_services}
    r3 = requests.put(f"{BASE_URL}/api/admin/auto-import/settings", json=restore, headers=admin_headers, timeout=15)
    assert r3.status_code == 200
    assert "brunch" not in [s["key"] for s in r3.json()["services"]]


def test_settings_put_empty_services_400(admin_headers):
    r = requests.put(f"{BASE_URL}/api/admin/auto-import/settings", json={"services": []}, headers=admin_headers, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_settings_forbidden_for_user(user_headers):
    r = requests.get(f"{BASE_URL}/api/admin/auto-import/settings", headers=user_headers, timeout=15)
    assert r.status_code == 403


# ---------- parse-test ---------- #
def test_parse_test_valid(admin_headers):
    r = requests.post(
        f"{BASE_URL}/api/admin/auto-import/parse-test",
        json={"filename": "Mariage de Sofie & Mohamed Oukoumbi soiree.mp4"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    p = j["parsed"]
    assert p["type"] == "prestation_video"
    assert p["couple"] == "Sofie & Mohamed Oukoumbi"
    assert p["service"] == "soiree"


def test_parse_test_invalid(admin_headers):
    r = requests.post(
        f"{BASE_URL}/api/admin/auto-import/parse-test",
        json={"filename": "Mariage Sofie Mohamed.mp4"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is False
    assert isinstance(j.get("error"), str) and j["error"]


def test_parse_test_forbidden_for_user(user_headers):
    r = requests.post(
        f"{BASE_URL}/api/admin/auto-import/parse-test",
        json={"filename": "x.mp4"}, headers=user_headers, timeout=15,
    )
    assert r.status_code == 403


# ---------- scan ---------- #
def test_scan_admin(admin_headers):
    r = requests.post(f"{BASE_URL}/api/admin/auto-import/scan", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True


def test_scan_forbidden_for_user(user_headers):
    r = requests.post(f"{BASE_URL}/api/admin/auto-import/scan", headers=user_headers, timeout=15)
    assert r.status_code == 403
