"""Which web origins the API trusts (DEF-S8).

The API used to allow every origin with credentials: ``CORS_ORIGINS`` defaulted
to ``*`` and Starlette answers ``*`` plus credentials by echoing whatever
``Origin`` the request carried, so any page on the internet could read the
answers of a signed-in panel. The bridge passed the same ``*`` to socket.io,
which switches its Origin check off, so any page could open a socket with the
reader's session cookie and drive their editor (cross-site WebSocket hijacking).

Now the trusted origins default to the service's own addresses
(``API_BASE_URL`` and ``WEB_PUBLIC_URL``), ``CORS_ORIGINS`` adds more, and the
bridge checks against the same list.

The extension connects to the bridge from the VS Code extension host, which is
Node, not a browser: socket.io-client there uses the ``ws`` package (which sends
an ``Origin`` header only when given the ``origin`` option, and
``BridgeOrchestrator`` never passes it) and ``xmlhttprequest-ssl`` for polling
(which refuses to set ``Origin`` at all). So the extension's handshake carries
no ``Origin`` header, and engine.io lets such a request through: that is pinned
below.
"""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from config.settings import Settings, settings
from src.main import app

FOREIGN = "http://evil.example"
OWN = "http://testserver"  # API_BASE_URL in tests/conftest.py
PUBLIC_URL = "http://192.168.50.141:8085"
HANDSHAKE = "/bridge/socket.io/?EIO=4&transport=polling"


@pytest.fixture
def http():
    return TestClient(app)


def _preflight(http: TestClient, origin: str):
    return http.options(
        "/api/extension/bridge/config",
        headers={"origin": origin, "access-control-request-method": "GET"},
    )


# --- CORS --------------------------------------------------------------------


def test_a_foreign_origin_gets_no_cors_grant(http):
    resp = _preflight(http, FOREIGN)
    assert "access-control-allow-origin" not in resp.headers

    simple = http.get("/health", headers={"origin": FOREIGN})
    assert "access-control-allow-origin" not in simple.headers


def test_the_api_base_url_is_trusted_by_default(http):
    resp = _preflight(http, OWN)
    assert resp.headers["access-control-allow-origin"] == OWN
    assert resp.headers["access-control-allow-credentials"] == "true"


def test_the_public_url_is_trusted_by_default(http, monkeypatch):
    monkeypatch.setattr(settings, "web_public_url", PUBLIC_URL)
    resp = _preflight(http, PUBLIC_URL)
    assert resp.headers["access-control-allow-origin"] == PUBLIC_URL


def test_cors_origins_adds_origins(http, monkeypatch):
    monkeypatch.setattr(settings, "cors_origins", "https://panel.example.com, https://other.example")
    assert _preflight(http, "https://panel.example.com").headers["access-control-allow-origin"] == (
        "https://panel.example.com"
    )
    assert _preflight(http, "https://other.example").headers["access-control-allow-origin"] == (
        "https://other.example"
    )
    # The service's own address stays trusted next to the extra ones.
    assert _preflight(http, OWN).headers["access-control-allow-origin"] == OWN
    assert "access-control-allow-origin" not in _preflight(http, FOREIGN).headers


def test_a_leftover_wildcard_no_longer_opens_everything(http, monkeypatch):
    """``CORS_ORIGINS=*`` is what every .env copied from .env.example carries,
    the live one included. It must not keep the hole open; it is ignored."""
    monkeypatch.setattr(settings, "cors_origins", "*")
    assert "access-control-allow-origin" not in _preflight(http, FOREIGN).headers
    assert _preflight(http, OWN).headers["access-control-allow-origin"] == OWN


@pytest.mark.parametrize("value", ["panel.example.com", "https://panel.example.com/app", "https://"])
def test_a_malformed_cors_origin_stops_the_server(value):
    # An entry that can never equal a browser's Origin would silently trust
    # nothing; better to say so at startup.
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        Settings(cors_origins=value)


def test_cors_origins_accepts_json_and_a_trailing_slash():
    s = Settings(cors_origins='["https://A.example.com/", "http://b.example:8080"]')
    assert s.cors_origins_list == ["https://a.example.com", "http://b.example:8080"]


# --- the bridge (socket.io) --------------------------------------------------


def test_the_bridge_refuses_a_foreign_origin(http):
    resp = http.get(HANDSHAKE, headers={"origin": FOREIGN})
    assert resp.status_code == 400
    assert "sid" not in resp.text


def test_the_bridge_accepts_the_extension_which_sends_no_origin(http):
    resp = http.get(HANDSHAKE)
    assert resp.status_code == 200
    assert '"sid"' in resp.text


def test_the_bridge_accepts_the_panel_on_its_own_address(http, monkeypatch):
    monkeypatch.setattr(settings, "web_public_url", PUBLIC_URL)
    assert http.get(HANDSHAKE, headers={"origin": OWN}).status_code == 200
    assert http.get(HANDSHAKE, headers={"origin": PUBLIC_URL}).status_code == 200


def test_the_bridge_accepts_the_address_the_browser_is_on(http):
    """live.js connects to ``window.location.origin``. A browser that opened the
    panel under a name missing from the list (``127.0.0.1`` next to
    ``localhost``, the machine's hostname) is still same-origin with the page it
    loaded, which only the page's own server can serve."""
    resp = http.get(
        HANDSHAKE,
        headers={"origin": "http://127.0.0.1:8085", "host": "127.0.0.1:8085"},
    )
    assert resp.status_code == 200


def test_the_bridge_follows_cors_origins(http, monkeypatch):
    monkeypatch.setattr(settings, "cors_origins", "https://panel.example.com")
    assert http.get(HANDSHAKE, headers={"origin": "https://panel.example.com"}).status_code == 200
    assert http.get(HANDSHAKE, headers={"origin": FOREIGN}).status_code == 400
