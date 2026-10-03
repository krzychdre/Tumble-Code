"""DEF-S3: the sign-in routes must refuse an `auth_redirect` that is not an
editor callback URI.

The callback page sends the browser, with a fresh one-time sign-in ticket in
the query string, to whatever `auth_redirect` the sign-in request carried. An
attacker who hands a victim a sign-in link with
`auth_redirect=https://evil.example` receives the victim's ticket and can
redeem it at POST /v1/client/sign_ins for a client token (account takeover).

Only a custom URI scheme with an `<publisher>.<name>` authority and nothing
after it is accepted: that is the exact shape the extension builds in
packages/cloud/src/WebAuthService.ts
(`${vscode.env.uriScheme}://${publisher}.${name}`).

The CLI signs in through a loopback redirect (RFC 8252 section 7.3): exactly
`http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>`
with a port from 1024 to 65535 and nothing after it. The callback answers it
with a 303 straight to `<redirect>/auth/clerk/callback?code=...&state=...`.
"""

from urllib.parse import parse_qs, urlsplit

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# The value the extension sends today (publisher QUB-IT, name tumble-code in
# src/package.json, uriScheme "vscode" in VS Code).
EXTENSION_REDIRECT = "vscode://QUB-IT.tumble-code"

ACCEPTED = [
    EXTENSION_REDIRECT,
    "vscode://RooVeterinaryInc.roo-cline",
    "vscode-insiders://QUB-IT.tumble-code",
    "cursor://QUB-IT.tumble-code",
]

# What the CLI sends (apps/cli: a one-shot listener on a random port).
LOOPBACK_ACCEPTED = [
    "http://127.0.0.1:1024",
    "http://127.0.0.1:54321",
    "http://127.0.0.1:65535",
    "http://localhost:8080",
    "http://[::1]:49152",
]

ACCEPTED += LOOPBACK_ACCEPTED

REJECTED = [
    "https://evil.example",
    "http://evil.example",
    "https://QUB-IT.tumble-code",
    "javascript:alert(document.cookie)",
    "javascript://QUB-IT.tumble-code",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "file://QUB-IT.tumble-code",
    # Right scheme, wrong shape: a path, a query, a fragment, credentials,
    # a port, an authority without the dot, trailing junk.
    "vscode://QUB-IT.tumble-code/auth/clerk/callback",
    "vscode://QUB-IT.tumble-code?x=1",
    "vscode://QUB-IT.tumble-code#x",
    "vscode://user@QUB-IT.tumble-code",
    "vscode://QUB-IT.tumble-code:80",
    "vscode://evil",
    "vscode://a.b.c",
    "vscode://QUB-IT.tumble-code\n",
    "vscode:QUB-IT.tumble-code",
    # The marker the web login stores internally must not come from a query.
    "web:/app",
    "",
]

# Loopback look-alikes: every one either reaches another host, is not a port
# the CLI can listen on, or carries something after the port.
LOOPBACK_REJECTED = [
    # Another host behind a loopback-looking prefix or user info.
    "http://127.0.0.1.evil.com:8080",
    "http://127.0.0.1:8080@evil.com",
    "http://evil.com@127.0.0.1:8080",
    "http://localhost.evil.com:8080",
    "http://localhost.:8080",
    # Other spellings of a loopback or wildcard address.
    "http://0.0.0.0:8080",
    "http://127.1:8080",
    "http://127.0.0.2:8080",
    "http://2130706433:8080",
    "http://0x7f000001:8080",
    "http://[::ffff:127.0.0.1]:8080",
    "http://[0:0:0:0:0:0:0:1]:8080",
    "http://::1:8080",
    # Ports: missing, empty, privileged, out of range, padded, signed.
    "http://127.0.0.1",
    "http://localhost",
    "http://[::1]",
    "http://127.0.0.1:",
    "http://127.0.0.1:0",
    "http://127.0.0.1:80",
    "http://127.0.0.1:1023",
    "http://127.0.0.1:65536",
    "http://localhost:99999",
    "http://127.0.0.1:123456",
    "http://127.0.0.1:08080",
    "http://127.0.0.1:+8080",
    "http://127.0.0.1:8_080",
    # Digits from other scripts (int() would accept them).
    "http://127.0.0.1:\uff18\uff10\uff18\uff10",
    "http://127.0.0.1:\u0668\u0660\u0668\u0660",
    # Anything after the port, the trailing slash included.
    "http://127.0.0.1:8080/",
    "http://127.0.0.1:8080/auth/clerk/callback",
    "http://127.0.0.1:8080?x=1",
    "http://127.0.0.1:8080#x",
    # Whitespace and line breaks.
    "http://127.0.0.1:8080\n",
    "http://127.0.0.1:8080\r\nSet-Cookie: x=1",
    " http://127.0.0.1:8080",
    "http://127.0.0.1:8080 ",
    "http://127.0.0.1 :8080",
    "http://127.0.0.1:\t8080",
    # Other schemes and broken shapes.
    "https://127.0.0.1:8080",
    "https://localhost:8080",
    "ws://127.0.0.1:8080",
    "HTTP://127.0.0.1:8080",
    "http://LOCALHOST:8080",
    "http:/127.0.0.1:8080",
    "http:127.0.0.1:8080",
    "//127.0.0.1:8080",
    "127.0.0.1:8080",
]

REJECTED += LOOPBACK_REJECTED

ROUTES = ["/extension/sign-in"]


@pytest.mark.parametrize("value", ACCEPTED)
def test_validator_accepts_editor_callback(value):
    from src.routers.browser import is_allowed_auth_redirect

    assert is_allowed_auth_redirect(value)


@pytest.mark.parametrize("value", REJECTED)
def test_validator_rejects_everything_else(value):
    from src.routers.browser import is_allowed_auth_redirect

    assert not is_allowed_auth_redirect(value)


@pytest.fixture
def mocked_sign_in():
    with patch("src.routers.browser.store_oauth_state", new_callable=AsyncMock) as store, \
         patch("src.routers.browser.get_authorize_url") as authorize:
        authorize.return_value = "https://auth.example.com/authorize?x=1"
        yield store


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("value", ACCEPTED)
def test_sign_in_routes_accept_editor_callback(client, mocked_sign_in, route, value):
    resp = client.get(
        route,
        params={"state": "s", "auth_redirect": value},
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307), resp.text
    assert mocked_sign_in.call_args[0][2] == value


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize(
    "value",
    [
        "https://evil.example",
        "javascript:alert(1)",
        "data:text/html,x",
        "file:///etc/passwd",
        "http://127.0.0.1.evil.com:8080",
        "http://127.0.0.1:8080@evil.com",
        "http://localhost:99999",
    ],
)
def test_sign_in_routes_reject_other_redirects_with_400(client, mocked_sign_in, route, value):
    resp = client.get(
        route,
        params={"state": "s", "auth_redirect": value},
        follow_redirects=False,
    )
    assert resp.status_code == 400, resp.text
    # Nothing was stored, so no callback can ever use this redirect.
    mocked_sign_in.assert_not_called()


@pytest.mark.parametrize(
    "stored",
    [
        "https://evil.example",
        "http://127.0.0.1.evil.com:8080",
        "http://127.0.0.1:8080@evil.com",
        "http://localhost:80",
        "http://127.0.0.1:8080/",
    ],
)
def test_callback_refuses_a_stored_foreign_redirect(client, stored):
    """Defense in depth: a state row stored before this fix (or written by any
    other path) with a foreign redirect must not receive a ticket."""
    with patch("src.routers.browser.get_oauth_state") as get_state, \
         patch("src.routers.browser.exchange_code_for_tokens") as exchange, \
         patch("src.routers.browser.get_userinfo") as userinfo, \
         patch("src.routers.browser.get_or_create_user") as create_user, \
         patch("src.routers.browser.create_session") as create_session, \
         patch("src.routers.browser.create_ticket") as create_ticket:
        get_state.return_value = MagicMock(auth_redirect=stored, code_verifier="v")
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "ak-1", "email": "e@example.com"}
        create_user.return_value = MagicMock(id="user-1")
        create_session.return_value = MagicMock(id="sess-1")
        create_ticket.return_value = "ticket-1"

        resp = client.get("/auth/clerk/callback", params={"code": "c", "state": "s"})

    assert resp.status_code == 400
    assert "evil" not in resp.text
    assert "location" not in resp.headers
    assert "ticket-1" not in resp.text
    exchange.assert_not_called()
    create_ticket.assert_not_called()


@pytest.mark.parametrize("redirect", LOOPBACK_ACCEPTED)
def test_callback_redirects_a_loopback_redirect_with_303(client, redirect):
    """The CLI's loopback redirect gets a plain 303 to its listener, not the
    editor's success page: a browser follows an http 3xx, and on a remote shell
    the failed navigation leaves the callback URL in the address bar."""
    with patch("src.routers.browser.get_oauth_state") as get_state, \
         patch("src.routers.browser.exchange_code_for_tokens") as exchange, \
         patch("src.routers.browser.get_userinfo") as userinfo, \
         patch("src.routers.browser.get_or_create_user") as create_user, \
         patch("src.routers.browser.create_session") as create_session, \
         patch("src.routers.browser.create_ticket") as create_ticket:
        get_state.return_value = MagicMock(auth_redirect=redirect, code_verifier="v")
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "ak-1", "email": "e@example.com"}
        create_user.return_value = MagicMock(id="user-1")
        create_session.return_value = MagicMock(id="sess-1")
        create_ticket.return_value = "tick+et/1="

        resp = client.get(
            "/auth/clerk/callback",
            params={"code": "c", "state": "st&ate"},
            follow_redirects=False,
        )

    assert resp.status_code == 303, resp.text
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["location"] == (
        redirect + "/auth/clerk/callback?code=tick%2Bet%2F1%3D&state=st%26ate"
    )


def test_editor_redirect_still_gets_the_success_page(client):
    """The editor's custom scheme keeps the HTML page: browsers block a 3xx to
    vscode://."""
    with patch("src.routers.browser.get_oauth_state") as get_state, \
         patch("src.routers.browser.exchange_code_for_tokens") as exchange, \
         patch("src.routers.browser.get_userinfo") as userinfo, \
         patch("src.routers.browser.get_or_create_user") as create_user, \
         patch("src.routers.browser.create_session") as create_session, \
         patch("src.routers.browser.create_ticket") as create_ticket:
        get_state.return_value = MagicMock(auth_redirect=EXTENSION_REDIRECT, code_verifier="v")
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "ak-1", "email": "e@example.com"}
        create_user.return_value = MagicMock(id="user-1")
        create_session.return_value = MagicMock(id="sess-1")
        create_ticket.return_value = "ticket-1"

        resp = client.get(
            "/auth/clerk/callback",
            params={"code": "c", "state": "s"},
            follow_redirects=False,
        )

    assert resp.status_code == 200
    assert "location" not in resp.headers
    assert EXTENSION_REDIRECT + "/auth/clerk/callback?code=ticket-1" in resp.text


async def test_loopback_sign_in_end_to_end(client):
    """/extension/sign-in with a loopback redirect, then Authentik's callback
    (only the Authentik calls mocked), lands on the CLI's listener with a
    ticket that /v1/client/sign_ins redeems once, exactly like the editor's."""
    redirect = "http://127.0.0.1:54321"
    state = "cli-state-123"

    start = client.get(
        "/extension/sign-in",
        params={"state": state, "auth_redirect": redirect},
        follow_redirects=False,
    )
    assert start.status_code in (302, 307), start.text

    with patch("src.routers.browser.exchange_code_for_tokens", new_callable=AsyncMock) as exchange, \
         patch("src.routers.browser.get_userinfo", new_callable=AsyncMock) as userinfo:
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "ak-cli-1", "email": "cli@example.com", "name": "Cli User"}
        resp = client.get(
            "/auth/clerk/callback",
            params={"code": "authentik-code", "state": state},
            follow_redirects=False,
        )

    assert resp.status_code == 303, resp.text
    target = urlsplit(resp.headers["location"])
    assert f"{target.scheme}://{target.netloc}" == redirect
    assert target.path == "/auth/clerk/callback"
    query = parse_qs(target.query)
    assert query["state"] == [state]
    ticket = query["code"][0]

    # The state row is spent: replaying the callback gets no second ticket.
    replay = client.get(
        "/auth/clerk/callback",
        params={"code": "authentik-code", "state": state},
        follow_redirects=False,
    )
    assert replay.status_code == 400

    first = client.post("/v1/client/sign_ins", data={"strategy": "ticket", "ticket": ticket})
    assert first.status_code == 200, first.text
    assert first.headers.get("authorization")
    second = client.post("/v1/client/sign_ins", data={"strategy": "ticket", "ticket": ticket})
    assert second.status_code == 401
