"""Wedding Stream Backend API tests.

Covers:
- Auth (register/login/me)
- Public catalog
- Video detail (locked/unlocked)
- Unlock by code
- Library
- Billing (checkout + status)
"""
import uuid
import requests
import pytest

# --- Auth ---
class TestAuth:
    def test_register_new_user(self, api_client, base_url):
        email = f'TEST_user_{uuid.uuid4().hex[:8]}@wedding.fr'
        r = api_client.post(f'{base_url}/api/auth/register', json={
            'email': email, 'password': 'pass1234', 'full_name': 'TEST User'
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'access_token' in data and data['access_token']
        assert data['user']['email'] == email.lower()
        assert data['user']['full_name'] == 'TEST User'
        assert data['user']['is_subscribed'] is False
        # save email for duplicate test
        pytest.registered_email = email

    def test_register_duplicate_email_returns_409(self, api_client, base_url):
        email = getattr(pytest, 'registered_email', None)
        if not email:
            pytest.skip('No previously registered email')
        r = api_client.post(f'{base_url}/api/auth/register', json={
            'email': email, 'password': 'pass1234', 'full_name': 'Dup'
        })
        assert r.status_code == 409, r.text

    def test_login_success(self, api_client, base_url):
        r = api_client.post(f'{base_url}/api/auth/login', json={
            'email': 'test@wedding.fr', 'password': 'test1234'
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'access_token' in data
        assert data['user']['email'] == 'test@wedding.fr'

    def test_login_wrong_password_returns_401(self, api_client, base_url):
        r = api_client.post(f'{base_url}/api/auth/login', json={
            'email': 'test@wedding.fr', 'password': 'WRONGpass!'
        })
        assert r.status_code == 401, r.text

    def test_me_with_bearer(self, api_client, base_url, auth_headers):
        r = requests.get(f'{base_url}/api/auth/me', headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data['email'] == 'test@wedding.fr'
        assert 'id' in data and 'full_name' in data

    def test_me_without_token_returns_401(self, api_client, base_url):
        r = requests.get(f'{base_url}/api/auth/me')
        assert r.status_code == 401


# --- Public Videos ---
class TestPublicVideos:
    def test_public_catalog_structure(self, api_client, base_url):
        r = api_client.get(f'{base_url}/api/videos/public')
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'featured' in data and 'rows' in data
        assert isinstance(data['featured'], list)
        assert isinstance(data['rows'], dict)
        assert len(data['featured']) >= 1
        # at least one is_top_france in featured
        assert any(v.get('is_top_france') for v in data['featured']), \
            'No featured video with is_top_france=true found'
        # featured sorted: top_france first
        first = data['featured'][0]
        assert first['is_top_france'] is True
        # full_url must NOT be exposed publicly
        for v in data['featured']:
            assert v['full_url'] is None
        # rows have expected categories
        assert any(cat in data['rows'] for cat in ["À l'affiche", 'Cérémonies', 'Soirées', 'Best Of'])

    def test_video_detail_locked_without_auth(self, api_client, base_url):
        catalog = api_client.get(f'{base_url}/api/videos/public').json()
        vid_id = catalog['featured'][0]['id']
        r = api_client.get(f'{base_url}/api/videos/{vid_id}')
        assert r.status_code == 200, r.text
        data = r.json()
        assert data['id'] == vid_id
        assert data['full_url'] is None
        assert data['trailer_url']  # trailer accessible

    def test_video_detail_locked_for_authed_not_unlocked(self, base_url, auth_headers):
        # find a video the test user has NOT unlocked: use Léa & Maxime (4BQZRLAS not used by test user yet?)
        # Safer: use any video not in user's library
        lib = requests.get(f'{base_url}/api/library', headers=auth_headers).json()
        unlocked_ids = {v['id'] for v in lib.get('videos', [])}
        catalog = requests.get(f'{base_url}/api/videos/public').json()
        all_vids = []
        for vs in catalog['rows'].values():
            all_vids.extend(vs)
        candidate = next((v for v in all_vids if v['id'] not in unlocked_ids), None)
        if not candidate:
            pytest.skip('All videos already unlocked for test user')
        r = requests.get(f'{base_url}/api/videos/{candidate["id"]}', headers=auth_headers)
        assert r.status_code == 200
        assert r.json()['full_url'] is None

    def test_video_not_found(self, api_client, base_url):
        r = api_client.get(f'{base_url}/api/videos/non-existent-id-xxx')
        assert r.status_code == 404


# --- Unlock flow ---
class TestUnlock:
    def test_unlock_invalid_code_returns_404(self, base_url, auth_headers):
        r = requests.post(f'{base_url}/api/videos/unlock',
                          headers=auth_headers, json={'code': 'INVALIDXX'})
        assert r.status_code == 404, r.text

    def test_unlock_without_auth_returns_401(self, base_url):
        r = requests.post(f'{base_url}/api/videos/unlock', json={'code': '3DPX2G57'})
        assert r.status_code == 401

    def test_unlock_valid_code_reveals_full_url(self, base_url, auth_headers):
        r = requests.post(f'{base_url}/api/videos/unlock',
                          headers=auth_headers, json={'code': '3DPX2G57'})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data['ok'] is True
        assert data['video']['full_url']
        assert data['video']['title'] == 'Camille & Antoine'
        vid_id = data['video']['id']
        # Persistence: subsequent GET returns full_url
        r2 = requests.get(f'{base_url}/api/videos/{vid_id}', headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()['full_url'], 'full_url should persist after unlock'

    def test_unlock_code_case_insensitive_and_whitespace(self, base_url, auth_headers):
        # Use second seeded code with lowercase + spaces
        r = requests.post(f'{base_url}/api/videos/unlock',
                          headers=auth_headers, json={'code': '  4bqzrlas  '})
        assert r.status_code == 200, r.text
        assert r.json()['video']['title'] == 'Léa & Maxime'


# --- Library ---
class TestLibrary:
    def test_library_returns_unlocked_videos(self, base_url, auth_headers):
        r = requests.get(f'{base_url}/api/library', headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'videos' in data and isinstance(data['videos'], list)
        # After previous unlocks, library should have at least 1 video
        assert len(data['videos']) >= 1
        for v in data['videos']:
            assert v['full_url'], 'Library videos must include full_url'

    def test_library_without_auth_returns_401(self, base_url):
        r = requests.get(f'{base_url}/api/library')
        assert r.status_code == 401


# --- Billing ---
class TestBilling:
    def test_billing_status_default_false_for_fresh_user(self, api_client, base_url):
        email = f'TEST_bill_{uuid.uuid4().hex[:8]}@wedding.fr'
        reg = api_client.post(f'{base_url}/api/auth/register', json={
            'email': email, 'password': 'pass1234', 'full_name': 'Bill User'
        })
        assert reg.status_code == 200
        token = reg.json()['access_token']
        r = requests.get(f'{base_url}/api/billing/status',
                         headers={'Authorization': f'Bearer {token}'})
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'is_subscribed' in data
        assert data['is_subscribed'] is False

    def test_billing_checkout_returns_url(self, base_url, auth_headers):
        r = requests.post(f'{base_url}/api/billing/checkout',
                          headers=auth_headers, json={})
        # Could return 200 with URL or 503 if Stripe key invalid in test env
        if r.status_code == 503:
            pytest.skip('Stripe not configured')
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'url' in data and data['url']
        assert data['url'].startswith('https://'), 'Checkout url must be https'
        assert 'session_id' in data and data['session_id']

    def test_billing_checkout_without_auth(self, base_url):
        r = requests.post(f'{base_url}/api/billing/checkout', json={})
        assert r.status_code == 401
