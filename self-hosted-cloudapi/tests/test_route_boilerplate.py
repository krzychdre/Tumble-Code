"""Characterization tests for the route boilerplate moved into dependencies (CAPI-M6).

Every route whose repeated preamble is shared (the Bearer client token in
routers/auth.py, the "not logged in, go to /app/login" check in routers/web.py,
the three sign-in handlers and the two HTML pages in routers/browser.py, the
extension token in dependencies.py) is pinned here from the outside, so the move
can be checked against the behaviour it had before.
"""

import time
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi.security import HTTPAuthorizationCredentials

from config.settings import settings
from src.auth.jwt_issuer import get_jwt_key, issue_session_token
from src.database import get_db
from src.models.user import Session as SessionModel, Ticket, User


# --- routers/auth.py: the Bearer client token --------------------------------


async def _signed_in(client, db_session) -> tuple[User, SessionModel, str]:
    """Seed a user with a ticket, sign in, and return the raw client token."""
    user = User(authentik_id="ak_m6", email="m6@example.com", first_name="M", last_name="Six")
    db_session.add(user)
    await db_session.flush()
    session = SessionModel(user_id=user.id)
    db_session.add(session)
    await db_session.flush()
    db_session.add(
        Ticket(
            code="m6_ticket",
            session_id=session.id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
    )
    await db_session.commit()
    resp = client.post("/v1/client/sign_ins", data={"strategy": "ticket", "ticket": "m6_ticket"})
    assert resp.status_code == 200, resp.text
    return user, session, resp.headers["Authorization"].removeprefix("Bearer ")


def _bearer_routes(session_id: str) -> list[tuple[str, str, dict]]:
    return [
        ("POST", f"/v1/client/sessions/{session_id}/tokens", {"_is_native": "1"}),
        ("GET", "/v1/me", {}),
        ("GET", "/v1/me/organization_memberships", {}),
        ("POST", f"/v1/client/sessions/{session_id}/remove", {"_is_native": "1"}),
    ]


def _call(client, method, url, data, headers):
    if method == "GET":
        return client.get(url, headers=headers)
    return client.post(url, data=data, headers=headers)


@pytest.mark.parametrize("index", range(4))
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": ""},
        {"Authorization": "Basic abc"},
        # The prefix is matched case-sensitively, with its single space.
        {"Authorization": "bearer abc"},
        {"Authorization": "Bearer"},
    ],
)
async def test_bearer_routes_refuse_a_missing_or_malformed_header(client, db_session, index, headers):
    _, session, _ = await _signed_in(client, db_session)
    method, url, data = _bearer_routes(session.id)[index]
    resp = _call(client, method, url, data, headers)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Missing or invalid Authorization header"}


@pytest.mark.parametrize("index", range(4))
@pytest.mark.parametrize("token", ["not-a-token", "", " spaced"])
async def test_bearer_routes_refuse_an_unknown_client_token(client, db_session, index, token):
    _, session, _ = await _signed_in(client, db_session)
    method, url, data = _bearer_routes(session.id)[index]
    resp = _call(client, method, url, data, {"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid client token"}


async def test_bearer_routes_accept_the_client_token(client, db_session):
    user, session, token = await _signed_in(client, db_session)
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post(f"/v1/client/sessions/{session.id}/tokens", data={"_is_native": "1"}, headers=headers)
    assert resp.status_code == 200 and resp.json()["jwt"]

    resp = client.get("/v1/me", headers=headers)
    assert resp.status_code == 200 and resp.json()["response"]["id"] == user.id

    resp = client.get("/v1/me/organization_memberships", headers=headers)
    assert resp.status_code == 200 and resp.json() == {"response": []}

    resp = client.post(f"/v1/client/sessions/{session.id}/remove", data={"_is_native": "1"}, headers=headers)
    assert resp.status_code == 200 and resp.json() == {"response": "Session removed"}

    # The session is over, so the same token no longer opens anything.
    resp = client.get("/v1/me", headers=headers)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid client token"}


async def test_bearer_routes_check_the_session_after_the_token(client, db_session):
    """A good token naming someone else's session id is a 404, not a 401."""
    _, _, token = await _signed_in(client, db_session)
    headers = {"Authorization": f"Bearer {token}"}
    for url in ("/v1/client/sessions/sess_other/tokens", "/v1/client/sessions/sess_other/remove"):
        resp = client.post(url, data={"_is_native": "1"}, headers=headers)
        assert resp.status_code == 404
        assert resp.json() == {"detail": "Session not found"}


# --- routers/web.py: "not logged in, go to /app/login" -----------------------

WEB_ROUTES = [
    ("GET", "/app"),
    ("GET", "/app?page=3&q=x&scope=all"),
    ("GET", "/app/metrics"),
    ("GET", "/app/metrics?period=7d"),
    ("GET", "/app/tasks/some-task"),
    ("POST", "/app/tasks/some-task/delete"),
    ("GET", "/app/settings"),
    ("GET", "/app/settings?ran=3"),
    ("POST", "/app/settings"),
    ("POST", "/app/settings/run"),
    ("POST", "/app/tasks/bulk-delete"),
]


@pytest.mark.parametrize("method,url", WEB_ROUTES)
def test_web_routes_send_an_anonymous_reader_to_the_login_page(client, method, url):
    resp = client.request(method, url, follow_redirects=False)
    assert resp.status_code == 303
    # Exactly this target: no "next" parameter, nothing carried over.
    assert resp.headers["location"] == "/app/login"
    assert resp.content == b""


@pytest.mark.parametrize("method,url", WEB_ROUTES)
def test_web_routes_ignore_a_forged_session_cookie(client, method, url):
    client.cookies.set("tumble_session", "forged.value.here")
    resp = client.request(method, url, follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def _web_login(client, db_session) -> User:
    from src.auth.web_session import COOKIE_NAME, _serializer

    user = User(authentik_id="ak_web_m6", email="web@example.com", first_name="Web", last_name="Reader")
    db_session.add(user)
    await db_session.flush()
    session = SessionModel(user_id=user.id)
    db_session.add(session)
    await db_session.commit()
    client.cookies.set(COOKIE_NAME, _serializer.dumps({"sid": session.id, "uid": user.id}))
    return user


@pytest.mark.parametrize(
    "method,url,status,location",
    [
        ("GET", "/app", 200, None),
        ("GET", "/app/metrics", 200, None),
        ("GET", "/app/tasks/some-task", 404, None),
        ("POST", "/app/tasks/some-task/delete", 303, "/app"),
        ("GET", "/app/settings", 200, None),
        ("POST", "/app/settings", 303, "/app/settings"),
        ("POST", "/app/settings/run", 303, "/app/settings?ran=0"),
        ("POST", "/app/tasks/bulk-delete", 303, "/app?scope=roots"),
    ],
)
async def test_web_routes_serve_a_signed_in_reader(client, db_session, method, url, status, location):
    await _web_login(client, db_session)
    resp = client.request(method, url, follow_redirects=False)
    assert resp.status_code == status, resp.text
    assert resp.headers.get("location") == location


async def test_a_logged_out_session_is_sent_to_the_login_page(client, db_session):
    user = await _web_login(client, db_session)
    await db_session.execute(
        SessionModel.__table__.update().where(SessionModel.user_id == user.id).values(is_active=False)
    )
    await db_session.commit()
    resp = client.get("/app", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


def test_the_login_page_itself_is_not_behind_the_login_check(client):
    with patch("src.routers.browser.store_oauth_state", new_callable=AsyncMock), \
         patch("src.routers.browser.get_authorize_url", return_value="https://auth.example/authorize?x=1"):
        resp = client.get("/app/login", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == "https://auth.example/authorize?x=1"


# --- routers/browser.py: the three sign-in handlers --------------------------

SIGN_IN_ROUTES = [
    ("/extension/sign-in", ""),
    ("/extension/provider-sign-up", "&screen_hint=signup"),
    ("/l/any-slug", ""),
    ("/l/another", ""),
]


@pytest.mark.parametrize("route,suffix", SIGN_IN_ROUTES)
def test_sign_in_routes_store_the_state_and_redirect_to_the_provider(client, route, suffix):
    with patch("src.routers.browser.store_oauth_state", new_callable=AsyncMock) as store, \
         patch("src.routers.browser.generate_pkce_pair", return_value=("verifier", "challenge")), \
         patch("src.routers.browser.get_authorize_url", return_value="https://auth.example/authorize?x=1") as url:
        resp = client.get(
            route,
            params={"state": "st", "auth_redirect": "vscode://QUB-IT.tumble-code"},
            headers={"host": "testserver"},
            follow_redirects=False,
        )
    assert resp.status_code == 307
    assert resp.headers["location"] == "https://auth.example/authorize?x=1" + suffix
    store.assert_awaited_once()
    assert store.call_args[0][1:] == ("st", "vscode://QUB-IT.tumble-code", "verifier")
    kwargs = url.call_args.kwargs
    assert kwargs["state"] == "st"
    assert kwargs["code_challenge"] == "challenge"
    assert kwargs["auth_redirect"] == "vscode://QUB-IT.tumble-code"


@pytest.mark.parametrize("route,_", SIGN_IN_ROUTES)
@pytest.mark.parametrize("params", [{"state": "st"}, {"auth_redirect": "vscode://QUB-IT.tumble-code"}])
def test_sign_in_routes_require_state_and_auth_redirect(client, route, _, params):
    resp = client.get(route, params=params, follow_redirects=False)
    assert resp.status_code == 422


@pytest.mark.parametrize("route,_", SIGN_IN_ROUTES)
def test_sign_in_routes_refuse_a_foreign_redirect_with_the_error_page(client, route, _):
    resp = client.get(route, params={"state": "st", "auth_redirect": "https://evil.example"})
    assert resp.status_code == 400
    page = _parse(resp.text)
    assert page.title == "Roo Code - Authentication Error"
    assert page.paragraphs == [
        "Invalid sign-in request.",
        "The sign-in link does not return to an editor. Start the sign-in again from the extension.",
    ]


# --- routers/browser.py: the two HTML pages ----------------------------------


class _Page(HTMLParser):
    """Pulls out what a reader and the browser act on: text, links, script."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.h1 = ""
        self.paragraphs: list[str] = []
        self.links: list[str] = []
        self.link_texts: list[str] = []
        self.scripts: list[str] = []
        self.styles: list[str] = []
        self.divs: list[str] = []
        self._stack: list[str] = []
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            return
        self._stack.append(tag)
        self._text = []
        if tag == "a":
            self.links.append(dict(attrs)["href"])
        if tag == "div":
            self.divs.append(dict(attrs).get("class") or "")

    def handle_endtag(self, tag):
        text = "".join(self._text)
        {
            "title": lambda: setattr(self, "title", text),
            "h1": lambda: setattr(self, "h1", text),
            "p": lambda: self.paragraphs.append(text),
            "a": lambda: self.link_texts.append(text),
            "script": lambda: self.scripts.append(text),
            "style": lambda: self.styles.append(text),
        }.get(tag, lambda: None)()
        if self._stack:
            self._stack.pop()
        self._text = []

    def handle_data(self, data):
        self._text.append(data)


def _parse(body: str) -> _Page:
    page = _Page()
    page.feed(body)
    return page


def _js_string_argument(script: str) -> str:
    """Decode the string literal passed to window.location.assign(...)."""
    start = script.index("window.location.assign(") + len("window.location.assign(")
    quote = script[start]
    assert quote in "'\"", script
    out, i = [], start + 1
    while script[i] != quote:
        ch = script[i]
        if ch == "\\":
            nxt = script[i + 1]
            if nxt == "x":
                out.append(chr(int(script[i + 2 : i + 4], 16)))
                i += 4
                continue
            if nxt == "u":
                out.append(chr(int(script[i + 2 : i + 6], 16)))
                i += 6
                continue
            out.append({"n": "\n", "t": "\t", "r": "\r"}.get(nxt, nxt))
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


TRICKY_URLS = [
    "vscode://QUB-IT.tumble-code/auth/clerk/callback?code=abc&state=xyz",
    "vscode://a.b/auth/clerk/callback?code=a%2Bb%3D&state=%2F",
    "vscode://a.b/x?q='quote'&r=\"dq\"",
    "vscode://a.b/x?q=</script><script>alert(1)</script>",
    "vscode://a.b/x?q=back\\slash&lt;&amp;",
    "vscode://a.b/x?q=żółw",
]


@pytest.mark.parametrize("url", TRICKY_URLS)
def test_success_page_sends_the_browser_to_exactly_the_url(url):
    from src.routers.browser import _auth_success_html

    body = _auth_success_html(url)
    assert body.startswith("<!DOCTYPE html>")
    page = _parse(body)
    assert page.title == "Roo Code - Authentication Successful"
    assert page.h1 == "Authentication Successful"
    assert page.paragraphs == ["You have successfully signed in to Roo Code.Returning to VS Code..."]
    assert page.links == [url]
    assert page.link_texts == ["Return to VS Code manually"]
    assert len(page.scripts) == 1
    assert _js_string_argument(page.scripts[0]) == url
    # The URL can never close the script element early.
    assert body.count("</script>") == 1
    assert "#4ec9b0" in page.styles[0]
    assert page.divs == ["container", "check"]


@pytest.mark.parametrize(
    "reason,detail",
    [
        ("Token exchange failed.", "Please try again."),
        ("<b>bold</b> & 'quoted' \"double\"", "</p><script>alert(1)</script>"),
        ("Only a reason.", ""),
    ],
)
def test_error_page_shows_the_reason_and_the_detail_as_text(reason, detail):
    from src.routers.browser import _auth_error_html

    body = _auth_error_html(reason, detail) if detail else _auth_error_html(reason)
    assert body.startswith("<!DOCTYPE html>")
    page = _parse(body)
    assert page.title == "Roo Code - Authentication Error"
    assert page.h1 == "Authentication Failed"
    assert page.paragraphs == [reason, detail]
    assert page.links == ["javascript:window.close()"]
    assert page.link_texts == ["Close this tab"]
    assert page.scripts == []
    assert "#f44747" in page.styles[0]
    assert page.divs == ["container", "cross"]
    assert "<script>" not in body


@pytest.mark.parametrize(
    "reason,message",
    [
        ("invalid_state", "Invalid or expired authentication state."),
        ("token_exchange_failed", "Token exchange failed."),
        ("userinfo_failed", "Failed to retrieve user information."),
        ("<script>", "An unknown authentication error occurred."),
        (None, "An unknown authentication error occurred."),
    ],
)
def test_auth_error_route_renders_the_error_page(client, reason, message):
    resp = client.get("/auth/error", params={"reason": reason} if reason else {})
    assert resp.status_code == 400
    assert resp.headers["content-type"] == "text/html; charset=utf-8"
    assert _parse(resp.text).paragraphs == [message, ""]


# --- dependencies.py: the extension's Bearer JWT -----------------------------


def _jwt(claims: dict) -> str:
    now = int(time.time())
    return jwt.encode({"exp": now + 60, "iat": now, "nbf": now, **claims}, get_jwt_key(), settings.jwt_algorithm)


@pytest.mark.parametrize(
    "headers,status,detail",
    [
        ({}, 401, "Missing authentication token"),
        ({"Authorization": "Basic abc"}, 401, "Missing authentication token"),
        ({"Authorization": "Bearer garbage"}, 401, "Invalid or expired token"),
        ({"Authorization": "Bearer " + _jwt({"iss": "rcc", "v": 1})}, 401, "Invalid token: missing user ID"),
    ],
)
def test_extension_routes_refuse_a_bad_token(client, headers, status, detail):
    resp = client.get("/api/extension/credit-balance", headers=headers)
    assert resp.status_code == status
    assert resp.json() == {"detail": detail}


def test_extension_routes_refuse_an_expired_token(client):
    now = int(time.time())
    token = jwt.encode(
        {"iss": "rcc", "v": 1, "sub": "u1", "exp": now - 10, "iat": now - 70, "nbf": now - 70},
        get_jwt_key(),
        settings.jwt_algorithm,
    )
    resp = client.get("/api/extension/credit-balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid or expired token"}


def test_extension_routes_accept_a_session_token(client):
    token = issue_session_token("user_x", "org_y")
    resp = client.get("/api/extension/credit-balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"balance": 0}


@pytest.mark.parametrize(
    "claims",
    [
        {"iss": "rcc", "v": 1, "r": {"u": "user_x", "o": "org_y", "t": "cj"}},
        {"iss": "rcc", "v": 1, "sub": "user_x"},
    ],
)
async def test_get_current_user_result(claims):
    from src.dependencies import get_current_user, get_current_user_optional

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=_jwt(claims))
    r = claims.get("r", {})
    expected = {"user_id": r.get("u") or claims.get("sub"), "org_id": r.get("o"), "token_type": r.get("t", "auth")}
    assert await get_current_user(creds) == expected
    assert await get_current_user_optional(creds) == expected


# Every token the server issues carries iss "rcc" and v 1 (jwt_issuer has
# stamped both since it was written), so a token signed with our key that lacks
# either, or names another issuer or version, was not issued by this server and
# is refused (owner decision 24).
FOREIGN_CLAIMS = [
    pytest.param({"v": 1, "sub": "user_x"}, id="missing-iss"),
    pytest.param({"iss": "someone-else", "v": 1, "sub": "user_x"}, id="wrong-iss"),
    pytest.param({"iss": "rcc", "sub": "user_x"}, id="missing-v"),
    pytest.param({"iss": "rcc", "v": 2, "sub": "user_x"}, id="wrong-v"),
    pytest.param({"iss": "rcc", "v": "1", "sub": "user_x"}, id="string-v"),
    pytest.param({"iss": "rcc", "v": True, "sub": "user_x"}, id="boolean-v"),
    pytest.param({"sub": "user_x"}, id="neither"),
]


@pytest.mark.parametrize("claims", FOREIGN_CLAIMS)
def test_extension_routes_refuse_a_token_without_our_issuer_and_version(client, claims):
    resp = client.get("/api/extension/credit-balance", headers={"Authorization": f"Bearer {_jwt(claims)}"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid or expired token"}


@pytest.mark.parametrize("claims", FOREIGN_CLAIMS)
async def test_get_current_user_refuses_a_token_without_our_issuer_and_version(claims):
    from fastapi import HTTPException

    from src.dependencies import get_current_user, get_current_user_optional

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=_jwt(claims))
    with pytest.raises(HTTPException) as exc:
        await get_current_user(creds)
    assert exc.value.status_code == 401
    assert await get_current_user_optional(creds) is None


def test_extension_routes_accept_a_static_token(client):
    # The shape the retired issue_static_token gave long-lived
    # ROO_CODE_CLOUD_TOKEN values, some of which users still hold.
    token = _jwt({"iss": "rcc", "v": 1, "sub": "cj_user_static", "r": {"u": "user_static", "o": "org_s", "t": "cj"}})
    resp = client.get("/api/extension/credit-balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"balance": 0}


async def test_get_current_user_optional_is_none_without_a_good_token():
    from src.dependencies import get_current_user_optional

    assert await get_current_user_optional(None) is None
    bad = HTTPAuthorizationCredentials(scheme="Bearer", credentials="garbage")
    assert await get_current_user_optional(bad) is None


def test_the_extension_token_check_opens_no_database_session(client):
    """get_current_user never reads the database, so it must not open a session.

    /credit-balance depends on nothing but the token: any session opened while
    serving it is the one the dependency asked for and never used.
    """
    opened = []

    async def counting_get_db():
        opened.append(1)
        yield None

    client.app.dependency_overrides[get_db] = counting_get_db
    token = issue_session_token("user_x")
    resp = client.get("/api/extension/credit-balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert opened == []
