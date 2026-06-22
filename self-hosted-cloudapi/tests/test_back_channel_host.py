"""Back-channel Host header behaviour.

Authentik routes to its OAuth/OIDC endpoints by HTTP Host header and 404s on an
invalid host (e.g. the compose service name `auth_server`, whose underscore is an
invalid RFC-1123 hostname). The api therefore presents the public front-channel
host (host of AUTHENTIK_BASE_URL) on every server-to-server call. These tests
lock that in so the OAuth callback can't silently regress to a 502.
"""

import pytest

import config.auth as auth_cfg
from config.auth import get_back_channel_host_header
from config.settings import settings
import src.auth.authentik as authentik


def test_host_header_is_front_channel_when_internal_url_set(monkeypatch):
    monkeypatch.setattr(settings, "authentik_base_url", "https://auth.tumblecode.dev")
    monkeypatch.setattr(settings, "authentik_internal_url", "http://auth_server:9000")

    host = get_back_channel_host_header()

    assert host == "auth.tumblecode.dev"
    assert "_" not in host  # the bug: underscore hosts get 404'd by Authentik


def test_host_header_keeps_port_for_dev_stack(monkeypatch):
    monkeypatch.setattr(settings, "authentik_base_url", "http://localhost:9000")
    monkeypatch.setattr(settings, "authentik_internal_url", "http://auth_server:9000")

    assert get_back_channel_host_header() == "localhost:9000"


def test_host_header_none_for_single_host(monkeypatch):
    # No internal URL → front == back channel → httpx's default Host is correct.
    monkeypatch.setattr(settings, "authentik_internal_url", None)

    assert get_back_channel_host_header() is None


class _FakeResp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class _CapturingClient:
    """Stand-in for httpx.AsyncClient that records the headers it was called with."""

    last_headers: dict = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None, headers=None):
        _CapturingClient.last_headers = headers or {}
        return _FakeResp({"access_token": "fake"})

    async def get(self, url, headers=None):
        _CapturingClient.last_headers = headers or {}
        return _FakeResp({"sub": "fake"})


@pytest.fixture
def capture_httpx(monkeypatch):
    monkeypatch.setattr(authentik.httpx, "AsyncClient", _CapturingClient)
    monkeypatch.setattr(settings, "authentik_base_url", "https://auth.tumblecode.dev")
    monkeypatch.setattr(settings, "authentik_internal_url", "http://auth_server:9000")
    return _CapturingClient


async def test_token_exchange_sends_brand_host(capture_httpx):
    await authentik.exchange_code_for_tokens("code", "verifier")

    headers = capture_httpx.last_headers
    assert headers["Host"] == "auth.tumblecode.dev"
    # Existing content-type header is preserved alongside the injected Host.
    assert headers["Content-Type"] == "application/x-www-form-urlencoded"


async def test_userinfo_sends_brand_host(capture_httpx):
    await authentik.get_userinfo("access-token")

    headers = capture_httpx.last_headers
    assert headers["Host"] == "auth.tumblecode.dev"
    assert headers["Authorization"] == "Bearer access-token"


async def test_discovery_sends_brand_host(capture_httpx):
    await authentik.get_openid_configuration()

    assert capture_httpx.last_headers["Host"] == "auth.tumblecode.dev"
