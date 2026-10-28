"""The OAuth state is bound to the browser that started the sign-in.

The extension and the CLI choose the ``state`` of /extension/sign-in, and the
callback used to accept it from whichever browser arrived with it, so a
sign-in started by one party could be finished in another party's browser.
The sign-in now sets a cookie naming its state and the callback requires it.
Only Authentik's own calls are stubbed: everything on this side is real.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from src.models.oauth import AuthentikStateStore
from src.routers.browser import STATE_COOKIE, state_cookie

EDITOR = "vscode://QUB-IT.tumble-code"


@contextmanager
def _authentik():
    with (
        patch(
            "src.routers.browser.exchange_code_for_tokens", new_callable=AsyncMock
        ) as exchange,
        patch("src.routers.browser.get_userinfo", new_callable=AsyncMock) as userinfo,
    ):
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "ak-1", "email": "a@example.com", "name": "A"}
        yield exchange


def _start(client, state, redirect=EDITOR):
    return client.get(
        "/extension/sign-in",
        params={"state": state, "auth_redirect": redirect},
        follow_redirects=False,
    )


def _callback(client, state):
    return client.get(
        "/auth/clerk/callback",
        params={"code": "authentik-code", "state": state},
        follow_redirects=False,
    )


@pytest.fixture
def other_browser(client):
    """A second browser on the same app and test database, with its own cookies."""
    return TestClient(client.app)


async def _state_rows(session_factory, state):
    async with session_factory() as s:
        return await s.scalar(
            select(func.count())
            .select_from(AuthentikStateStore)
            .where(AuthentikStateStore.state == state)
        )


async def test_the_sign_in_sets_a_cookie_only_the_callback_receives(client):
    resp = _start(client, "state-1")

    assert resp.status_code in (302, 307)
    cookie = next(
        c for c in resp.headers.get_list("set-cookie") if c.startswith(STATE_COOKIE)
    ).lower()
    assert "httponly" in cookie
    assert "path=/auth/clerk/callback" in cookie
    assert "samesite=lax" in cookie
    assert "max-age=600" in cookie


async def test_a_callback_in_another_browser_is_refused_and_spends_nothing(
    client, other_browser, session_factory
):
    _start(client, "state-1")

    with _authentik() as exchange:
        stolen = _callback(other_browser, "state-1")
        exchange.assert_not_awaited()
        assert stolen.status_code == 400
        assert "another browser" in stolen.text
        assert await _state_rows(session_factory, "state-1") == 1

        own = _callback(client, "state-1")

    assert own.status_code == 200, own.text
    assert f"{EDITOR}/auth/clerk/callback?code=" in own.text


async def test_a_web_sign_in_is_bound_to_its_browser_too(
    client, other_browser, session_factory
):
    start = client.get("/app/login", follow_redirects=False)
    assert start.status_code in (302, 307)
    async with session_factory() as s:
        state = await s.scalar(select(AuthentikStateStore.state))

    with _authentik():
        stolen = _callback(other_browser, state)
        own = _callback(client, state)

    assert stolen.status_code == 400
    assert "tumble_session=" not in stolen.headers.get("set-cookie", "")
    assert own.status_code == 303 and own.headers["location"] == "/app"


async def test_two_sign_ins_started_in_one_browser_can_both_finish(client):
    _start(client, "state-1")
    _start(client, "state-2")

    with _authentik():
        assert _callback(client, "state-1").status_code == 200
        assert _callback(client, "state-2").status_code == 200


async def test_a_state_already_stored_is_refused_with_400(client, session_factory):
    assert _start(client, "state-1").status_code in (302, 307)

    again = _start(client, "state-1")

    assert again.status_code == 400
    assert "already used" in again.text
    assert await _state_rows(session_factory, "state-1") == 1


async def test_the_cookie_is_dropped_once_the_sign_in_finished(client):
    _start(client, "state-1")
    with _authentik():
        done = _callback(client, "state-1")

    name, _ = state_cookie("state-1")
    assert any(
        c.startswith(f'{name}=""') or c.startswith(f"{name}=;")
        for c in done.headers.get_list("set-cookie")
    ), done.headers.get_list("set-cookie")
    assert name not in client.cookies


async def test_another_states_cookie_does_not_count(client, other_browser):
    _start(other_browser, "state-mine")
    _start(client, "state-1")

    with _authentik():
        resp = client.get(
            "/auth/clerk/callback",
            params={"code": "c", "state": "state-1"},
            headers={
                "cookie": f"{state_cookie('state-1')[0]}={state_cookie('state-mine')[1]}"
            },
            follow_redirects=False,
        )

    assert resp.status_code == 400


async def test_a_forged_binding_cookie_does_not_count(client):
    _start(client, "state-1")
    client.cookies.clear()

    with _authentik():
        resp = client.get(
            "/auth/clerk/callback",
            params={"code": "c", "state": "state-1"},
            headers={"cookie": f"{state_cookie('state-1')[0]}=not-a-signed-value"},
            follow_redirects=False,
        )

    assert resp.status_code == 400
