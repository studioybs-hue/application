import os
import requests
import pytest

BASE_URL = (os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL') or 'https://mariagevideo.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope='session')
def base_url():
    return BASE_URL


@pytest.fixture(scope='session')
def api_client():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


@pytest.fixture(scope='session')
def test_user_token(api_client):
    """Login pre-seeded test user."""
    r = api_client.post(f'{BASE_URL}/api/auth/login', json={
        'email': 'test@wedding.fr', 'password': 'test1234'
    })
    if r.status_code != 200:
        pytest.skip(f'Pre-seeded test user login failed: {r.status_code} {r.text}')
    return r.json()['access_token']


@pytest.fixture(scope='session')
def auth_headers(test_user_token):
    return {'Authorization': f'Bearer {test_user_token}', 'Content-Type': 'application/json'}
