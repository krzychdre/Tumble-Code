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
"""

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

ROUTES = ["/extension/sign-in", "/extension/provider-sign-up", "/l/some-slug"]


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


def test_callback_refuses_a_stored_foreign_redirect(client):
    """Defense in depth: a state row stored before this fix (or written by any
    other path) with a foreign redirect must not receive a ticket."""
    with patch("src.routers.browser.get_oauth_state") as get_state, \
         patch("src.routers.browser.exchange_code_for_tokens") as exchange, \
         patch("src.routers.browser.get_userinfo") as userinfo, \
         patch("src.routers.browser.get_or_create_user") as create_user, \
         patch("src.routers.browser.create_session") as create_session, \
         patch("src.routers.browser.create_ticket") as create_ticket:
        get_state.return_value = MagicMock(
            auth_redirect="https://evil.example", code_verifier="v"
        )
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "ak-1", "email": "e@example.com"}
        create_user.return_value = MagicMock(id="user-1")
        create_session.return_value = MagicMock(id="sess-1")
        create_ticket.return_value = "ticket-1"

        resp = client.get("/auth/clerk/callback", params={"code": "c", "state": "s"})

    assert resp.status_code == 400
    assert "evil.example" not in resp.text
    assert "ticket-1" not in resp.text
    exchange.assert_not_called()
    create_ticket.assert_not_called()
