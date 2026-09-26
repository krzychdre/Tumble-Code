"""The ``BRIDGE_PATH`` setting decides where the socket.io bridge listens (DEF-C31).

The extension and the web panel both connect to the path the server advertises
(``socketBridgePath`` from ``/api/extension/bridge/config``, ``bridgePath`` in
the task page's live config), and both are read from ``settings.bridge_path``.
The mount itself used to be the literal ``/bridge``, so changing the setting
advertised a path nobody listened on. The default stays ``/bridge/socket.io``.
"""

import importlib

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from config.settings import Settings, settings


def _handshake(client: TestClient, path: str):
    # No Origin header: the extension's Node client sends none (see
    # test_cors_origins), so engine.io lets the handshake through.
    return client.get(f"{path}/?EIO=4&transport=polling")


def test_the_default_path_is_unchanged():
    assert Settings().bridge_path == "/bridge/socket.io"


def test_the_app_listens_on_the_configured_path(monkeypatch):
    import src.main

    monkeypatch.setattr(settings, "bridge_path", "/rc/live/socket.io")
    try:
        reloaded = importlib.reload(src.main)
        client = TestClient(reloaded.app)

        resp = _handshake(client, "/rc/live/socket.io")
        assert resp.status_code == 200
        assert '"sid"' in resp.text

        assert _handshake(client, "/bridge/socket.io").status_code == 404
    finally:
        monkeypatch.undo()
        importlib.reload(src.main)


def test_the_default_app_still_listens_on_bridge():
    from src.main import app

    resp = _handshake(TestClient(app), "/bridge/socket.io")
    assert resp.status_code == 200
    assert '"sid"' in resp.text


@pytest.mark.parametrize(
    "value, expected",
    [
        ("/bridge/socket.io", "/bridge/socket.io"),
        ("/rc/live/socket.io/", "/rc/live/socket.io"),
    ],
)
def test_bridge_path_is_normalised(value, expected):
    assert Settings(bridge_path=value).bridge_path == expected


@pytest.mark.parametrize("value", ["bridge/socket.io", "/socket.io", "/", "", "/a//b"])
def test_a_bridge_path_that_cannot_be_mounted_is_refused(value):
    # A single segment would have to be mounted at the root, where it would
    # shadow every route registered after it; fail at startup instead.
    with pytest.raises(ValidationError, match="BRIDGE_PATH"):
        Settings(bridge_path=value)


# The two transports cross the Starlette Mount differently: polling is an HTTP
# request (pinned by test_the_default_app_still_listens_on_bridge above), the
# upgrade the extension actually uses is a WebSocket scope. The Mount's path
# handling changed under us once already (see the NOTE above mount_bridge in
# src/main.py), so the WebSocket path is pinned too: a Starlette upgrade that
# breaks it fails here instead of in a live session (DEP-5).


def test_the_default_bridge_accepts_a_websocket_handshake():
    from src.main import app

    with TestClient(app).websocket_connect(
        "/bridge/socket.io/?EIO=4&transport=websocket",
        # A real client (the ws package, a browser) sends these; engine.io
        # refuses the upgrade without them.
        headers={"Upgrade": "websocket", "Connection": "Upgrade"},
    ) as ws:
        opening = ws.receive_text()
    assert opening.startswith("0{")
    assert '"sid"' in opening
