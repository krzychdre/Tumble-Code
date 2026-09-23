"""Opening the web panel from other machines.

Two halves, tested apart:

* **Who may open it** (``WEB_ALLOWED_NETWORKS``, src/auth/network_access.py):
  the allowlist itself, the 403 on ``/app``, and the session cookie being
  ignored for a client outside the list.
* **Signing in from there** (``WEB_PUBLIC_URL``, config/auth.py): a browser on
  another machine was sent to ``http://localhost:9000`` to sign in and back to
  ``http://localhost:8085`` (measured on the live stack: ``GET /app/login`` via
  ``192.168.50.141`` answered 307 to exactly that), and on its side localhost is
  itself.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from config import auth as auth_config
from config.settings import Settings, settings
from src.auth import network_access
from src.auth.network_access import client_allowed, describe_policy
from src.auth.web_session import _serializer
from src.database import get_db
from src.main import app
from src.models.task import Task, TaskShare
from src.models.user import Session, User

LAN = "192.168.50.0/24"
SERVER = "192.168.50.141"
PUBLIC_URL = f"http://{SERVER}:8085"


@pytest.fixture
def allowlist(monkeypatch):
    """Set WEB_ALLOWED_NETWORKS for one test, outside any container."""

    def _set(value: str, gateway: str | None = None):
        monkeypatch.setattr(settings, "web_allowed_networks", value)
        monkeypatch.setattr(network_access, "container_gateway", lambda: gateway)

    return _set


@pytest.fixture
def local_stack(monkeypatch):
    """The bundled compose stack's single-host configuration, plus a public URL."""
    monkeypatch.setattr(settings, "authentik_base_url", "http://localhost:9000")
    monkeypatch.setattr(settings, "authentik_redirect_uri", "http://localhost:8085/auth/clerk/callback")
    monkeypatch.setattr(settings, "web_public_url", PUBLIC_URL)


def _client_from(address: str, session_factory) -> TestClient:
    """A TestClient whose requests arrive from ``address``, on the test DB."""

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app, client=(address, 50000), follow_redirects=False)


@pytest.fixture
def client_from(session_factory):
    yield lambda address: _client_from(address, session_factory)
    app.dependency_overrides.pop(get_db, None)


# --- the settings refuse what would silently misbehave -----------------------


def test_a_typo_in_the_allowlist_stops_the_server():
    with pytest.raises(ValidationError, match="192.168.50.0/33"):
        Settings(web_allowed_networks=f"{LAN},192.168.50.0/33")
    with pytest.raises(ValidationError, match="laptop.lan"):
        Settings(web_allowed_networks="laptop.lan")
    assert Settings(web_allowed_networks=f" {LAN} , 10.8.0.7 ,").web_allowed_networks


@pytest.mark.parametrize(
    "value",
    [f"{PUBLIC_URL}/", f"{PUBLIC_URL}/app", "192.168.50.141:8085", "ftp://192.168.50.141"],
)
def test_the_public_url_must_be_a_bare_origin(value):
    # The blueprint appends the callback path to this exact string.
    with pytest.raises(ValidationError, match="WEB_PUBLIC_URL"):
        Settings(web_public_url=value)


def test_an_empty_public_url_means_unset():
    assert Settings(web_public_url="").web_public_url is None
    assert Settings(web_public_url=PUBLIC_URL).web_public_url == PUBLIC_URL


# --- who may open the panel --------------------------------------------------


def test_an_empty_allowlist_leaves_the_panel_open(allowlist):
    allowlist("")
    assert client_allowed("203.0.113.9")
    assert client_allowed("testclient")
    assert describe_policy().startswith("any client")


def test_the_allowlist_admits_its_networks_and_loopback_only(allowlist):
    allowlist(f"{LAN},10.8.0.7")
    assert client_allowed("192.168.50.20")
    assert client_allowed("10.8.0.7")
    assert client_allowed("127.0.0.1")
    assert client_allowed("::1")
    # A dual-stack socket reports an IPv4 peer in its IPv6-mapped form.
    assert client_allowed("::ffff:192.168.50.20")

    assert not client_allowed("192.168.51.20")
    assert not client_allowed("10.8.0.8")
    assert not client_allowed("::ffff:192.168.51.20")
    # Not an address at all: nothing to match, so no.
    assert not client_allowed("testclient")
    assert not client_allowed(None)


def test_in_a_container_the_host_itself_stays_allowed(allowlist):
    """Docker publishes the port through docker-proxy: a browser on the host
    opening localhost:8085 arrives from the compose network's gateway (the live
    stack logged 192.168.0.1 for it), not from loopback."""
    allowlist(LAN, gateway="192.168.0.1")
    assert client_allowed("192.168.0.1")
    assert not client_allowed("192.168.0.2")
    assert "192.168.0.1 (container gateway" in describe_policy()


def test_the_container_gateway_is_read_from_the_route_table(tmp_path, monkeypatch):
    route = tmp_path / "route"
    route.write_text(
        "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n"
        "eth0\t00000000\t0100A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n"
        "eth0\t0000A8C0\t00000000\t0001\t0\t0\t0\t00F0FFFF\t0\t0\t0\n"
    )
    marker = tmp_path / ".dockerenv"
    marker.touch()
    monkeypatch.setattr(network_access, "_ROUTE_TABLE", route)
    monkeypatch.setattr(network_access, "_CONTAINER_MARKERS", (marker,))
    network_access.container_gateway.cache_clear()
    try:
        assert network_access.container_gateway() == "192.168.0.1"
        marker.unlink()
        network_access.container_gateway.cache_clear()
        assert network_access.container_gateway() is None
    finally:
        network_access.container_gateway.cache_clear()


def test_the_panel_answers_403_outside_the_allowlist(allowlist, client_from):
    allowlist(LAN)
    outsider = client_from("192.168.51.7")

    for path in ("/app", "/app/metrics", "/app/login", "/app/tasks/x"):
        resp = outsider.get(path)
        assert resp.status_code == 403, path
    assert "This panel is not open to 192.168.51.7" in resp.text
    # A sign-in button here would only lead to another 403.
    assert 'href="/app/login"' not in resp.text

    # Not the panel: health, public assets, share links, the extension API.
    assert outsider.get("/health").status_code == 200
    assert outsider.get("/static/app.css").status_code == 200
    assert outsider.get("/shared/missing").status_code == 404

    # Inside the list the gate is invisible: an anonymous visitor is sent to sign in.
    insider = client_from("192.168.50.20")
    assert insider.get("/app").status_code == 303


async def test_a_session_cookie_does_not_travel_outside_the_allowlist(
    allowlist, client_from, db_session
):
    """A private share needs a signed-in viewer. A cookie obtained on an allowed
    network must not keep working from elsewhere on /shared, which is not behind
    the /app gate."""
    db_session.add(User(id="user_web", authentik_id="ak_web", email="w@example.com"))
    await db_session.flush()
    db_session.add(Session(id="sess_web", user_id="user_web", is_active=True))
    db_session.add(Task(id="task-private", user_id="user_web", title="Private run"))
    await db_session.flush()
    db_session.add(TaskShare(task_id="task-private", visibility="organization"))
    await db_session.commit()
    cookie = _serializer.dumps({"sid": "sess_web", "uid": "user_web"})

    def signed_in_from(address):
        client = client_from(address)
        client.cookies.set("tumble_session", cookie)
        return client

    allowlist(LAN)
    inside = signed_in_from("192.168.50.20").get("/shared/task-private")
    outside = signed_in_from("192.168.51.7").get("/shared/task-private")

    assert inside.status_code == 200 and "Private run" in inside.text
    assert outside.status_code == 303
    assert outside.headers["location"] == "/app/login"


# --- signing in from another machine -----------------------------------------


def test_the_front_channel_follows_the_public_host_and_nothing_else(local_stack):
    public = auth_config.front_channel(f"{SERVER}:8085")
    assert public.authorize_url == f"http://{SERVER}:9000/application/o/authorize/"
    assert public.redirect_uri == f"{PUBLIC_URL}/auth/clerk/callback"

    local = auth_config.front_channel("localhost:8085")
    assert local.authorize_url == "http://localhost:9000/application/o/authorize/"
    assert local.redirect_uri == "http://localhost:8085/auth/clerk/callback"

    # Whatever else a Host header says is never used to build a URL.
    for host in ("evil.example:8085", "192.168.50.134:8085", None):
        assert auth_config.front_channel(host) == local


def test_an_authentik_with_a_real_name_is_left_as_configured(local_stack, monkeypatch):
    monkeypatch.setattr(settings, "authentik_base_url", "https://auth.example.com")
    front = auth_config.front_channel(f"{SERVER}:8085")
    assert front.authorize_url == "https://auth.example.com/application/o/authorize/"
    assert front.redirect_uri == f"{PUBLIC_URL}/auth/clerk/callback"


def test_an_ipv6_public_host_is_bracketed(local_stack, monkeypatch):
    monkeypatch.setattr(settings, "web_public_url", "http://[fd00::5]:8085")
    front = auth_config.front_channel("[fd00::5]:8085")
    assert front.authorize_url == "http://[fd00::5]:9000/application/o/authorize/"
    assert front.redirect_uri == "http://[fd00::5]:8085/auth/clerk/callback"


def test_web_login_on_the_public_host_goes_to_authentik_on_that_host(local_stack, client_from):
    resp = client_from("192.168.50.20").get("/app/login", headers={"host": f"{SERVER}:8085"})

    assert resp.status_code == 307
    target = urlsplit(resp.headers["location"])
    assert f"{target.scheme}://{target.netloc}{target.path}" == f"http://{SERVER}:9000/application/o/authorize/"
    assert parse_qs(target.query)["redirect_uri"] == [f"{PUBLIC_URL}/auth/clerk/callback"]


def test_web_login_on_localhost_is_unchanged(local_stack, client_from):
    resp = client_from("127.0.0.1").get("/app/login", headers={"host": "localhost:8085"})

    target = urlsplit(resp.headers["location"])
    assert target.netloc == "localhost:9000"
    assert parse_qs(target.query)["redirect_uri"] == ["http://localhost:8085/auth/clerk/callback"]


def test_web_login_under_another_name_moves_to_the_public_url_first(local_stack, client_from):
    """The machine's second address (wifi next to ethernet) has no registered
    callback; a sign-in started there could never come back."""
    resp = client_from("192.168.50.20").get("/app/login", headers={"host": "192.168.50.134:8085"})

    assert resp.status_code == 303
    assert resp.headers["location"] == f"{PUBLIC_URL}/app/login"


@pytest.fixture
def callback_mocks():
    with patch("src.routers.browser.exchange_code_for_tokens", new_callable=AsyncMock) as exchange, \
         patch("src.routers.browser.get_userinfo", new_callable=AsyncMock) as userinfo, \
         patch("src.routers.browser.get_oauth_state", new_callable=AsyncMock) as get_state, \
         patch("src.routers.browser.get_or_create_user", new_callable=AsyncMock) as create_user, \
         patch("src.routers.browser.create_session", new_callable=AsyncMock) as create_session:
        get_state.return_value = MagicMock(auth_redirect="web:/app", code_verifier="verifier")
        exchange.return_value = {"access_token": "at"}
        userinfo.return_value = {"sub": "ak-1", "email": "u@example.com", "name": "U Ser"}
        create_user.return_value = MagicMock(id="user-1")
        create_session.return_value = MagicMock(id="sess-1")
        yield exchange


def test_the_callback_exchanges_the_code_with_the_uri_it_was_issued_for(
    local_stack, client_from, callback_mocks
):
    resp = client_from("192.168.50.20").get(
        "/auth/clerk/callback?code=c&state=s", headers={"host": f"{SERVER}:8085"}
    )

    assert resp.status_code == 303 and resp.headers["location"] == "/app"
    assert "tumble_session=" in resp.headers["set-cookie"]
    assert callback_mocks.await_args.kwargs["redirect_uri"] == f"{PUBLIC_URL}/auth/clerk/callback"


def test_a_web_sign_in_is_refused_outside_the_allowlist_before_the_code_is_spent(
    local_stack, allowlist, client_from, callback_mocks
):
    allowlist(LAN)
    resp = client_from("192.168.51.7").get(
        "/auth/clerk/callback?code=c&state=s", headers={"host": f"{SERVER}:8085"}
    )

    assert resp.status_code == 403
    assert "set-cookie" not in resp.headers
    callback_mocks.assert_not_awaited()
