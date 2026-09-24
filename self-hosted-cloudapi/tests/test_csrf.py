"""Cross-site request forgery on the web panel (DEF-S9).

The panel's forms (delete a task, bulk delete, save and run the retention
policy) are authenticated by the ``tumble_session`` cookie alone, so any page
the reader visits could submit them. ``SameSite=Lax`` keeps the cookie off
cross-site POSTs, but not off same-site ones, and every other service on the
same host (Authentik on :9000, anything else on the LAN address) is same-site.

Now a state-changing request that carries the session cookie must come from a
trusted page (src/auth/origins.py): its ``Origin`` header decides, and without
one its ``Referer``. A request with neither is let through: browsers send
``Origin`` on every cross-origin POST (and on same-origin ones too), so such a
request is not a forged browser request but a script holding the cookie
itself, against which a header check protects nothing.

The cookie is also ``Secure`` when the browser reached us over https.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from config.settings import settings
from src.auth.web_session import _serializer
from src.database import get_db
from src.main import app
from src.models.task import Task
from src.models.user import Session, User
from tests.test_remote_access import callback_mocks, client_from, local_stack  # noqa: F401

FOREIGN = "http://evil.example"
OWN = "http://testserver"  # API_BASE_URL in tests/conftest.py
PUBLIC_URL = "http://192.168.50.141:8085"

STATE_CHANGING = [
    ("/app/tasks/task-csrf/delete", {}),
    ("/app/tasks/bulk-delete", {"task_ids": "task-csrf"}),
    ("/app/settings", {"enabled": "1", "max_tasks": "1"}),
    ("/app/settings/run", {}),
]


@pytest.fixture
async def signed_in(db_session, session_factory):
    """A TestClient carrying a real session cookie for the owner of task-csrf."""
    db_session.add(User(id="user_csrf", authentik_id="ak_csrf", email="c@example.com"))
    await db_session.flush()
    db_session.add(Session(id="sess_csrf", user_id="user_csrf", is_active=True))
    db_session.add(Task(id="task-csrf", user_id="user_csrf", title="Keep me"))
    await db_session.commit()

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app, follow_redirects=False)
    client.cookies.set("tumble_session", _serializer.dumps({"sid": "sess_csrf", "uid": "user_csrf"}))
    yield client
    app.dependency_overrides.pop(get_db, None)


async def _task_exists(session_factory) -> bool:
    async with session_factory() as s:
        count = (
            await s.execute(select(func.count(Task.id)).where(Task.id == "task-csrf"))
        ).scalar_one()
    return count == 1


@pytest.mark.parametrize("path,form", STATE_CHANGING)
async def test_a_foreign_origin_is_refused(signed_in, session_factory, path, form):
    resp = signed_in.post(path, data=form, headers={"origin": FOREIGN})
    assert resp.status_code == 403
    assert await _task_exists(session_factory)


@pytest.mark.parametrize("path,form", STATE_CHANGING)
async def test_a_foreign_referer_is_refused_when_there_is_no_origin(
    signed_in, session_factory, path, form
):
    resp = signed_in.post(path, data=form, headers={"referer": f"{FOREIGN}/page"})
    assert resp.status_code == 403
    assert await _task_exists(session_factory)


async def test_a_sandboxed_page_is_refused(signed_in, session_factory):
    # An iframe with sandbox (or a data: URL) sends the literal "null".
    resp = signed_in.post("/app/tasks/task-csrf/delete", headers={"origin": "null"})
    assert resp.status_code == 403
    assert await _task_exists(session_factory)


async def test_origin_wins_over_a_trusted_referer(signed_in, session_factory):
    resp = signed_in.post(
        "/app/tasks/task-csrf/delete",
        headers={"origin": FOREIGN, "referer": f"{OWN}/app"},
    )
    assert resp.status_code == 403
    assert await _task_exists(session_factory)


async def test_a_same_origin_post_still_works(signed_in, session_factory):
    resp = signed_in.post("/app/tasks/task-csrf/delete", headers={"origin": OWN})
    assert resp.status_code == 303 and resp.headers["location"] == "/app"
    assert not await _task_exists(session_factory)


async def test_a_same_origin_referer_still_works(signed_in, session_factory):
    resp = signed_in.post("/app/tasks/task-csrf/delete", headers={"referer": f"{OWN}/app/tasks/task-csrf"})
    assert resp.status_code == 303
    assert not await _task_exists(session_factory)


async def test_the_public_url_and_the_browsers_own_address_work(
    signed_in, session_factory, monkeypatch
):
    monkeypatch.setattr(settings, "web_public_url", PUBLIC_URL)
    resp = signed_in.post("/app/settings", data={"max_tasks": "5"}, headers={"origin": PUBLIC_URL})
    assert resp.status_code == 303

    # The panel opened under an address missing from the list (the DHCP
    # lease moved, a hostname): the form is same-origin with the request.
    resp = signed_in.post(
        "/app/tasks/task-csrf/delete",
        headers={"origin": "http://192.168.50.134:8085", "host": "192.168.50.134:8085"},
    )
    assert resp.status_code == 303
    assert not await _task_exists(session_factory)


async def test_no_origin_and_no_referer_is_let_through(signed_in, session_factory):
    """Not a browser: browsers always send Origin on a cross-origin POST."""
    resp = signed_in.post("/app/tasks/task-csrf/delete")
    assert resp.status_code == 303
    assert not await _task_exists(session_factory)


async def test_requests_without_the_session_cookie_are_not_checked(client):
    """The extension's Bearer-token API carries no cookie, so CSRF cannot ride
    on it; the check stays out of its way whatever the Origin."""
    resp = client.post("/app/tasks/x/delete", headers={"origin": FOREIGN}, follow_redirects=False)
    assert resp.status_code == 303 and resp.headers["location"] == "/app/login"


async def test_reading_the_panel_is_not_checked(signed_in):
    # A GET changes nothing; links from other sites must keep working.
    resp = signed_in.get("/app", headers={"origin": FOREIGN, "referer": f"{FOREIGN}/x"})
    assert resp.status_code == 200


# --- the Secure flag ---------------------------------------------------------


def _session_cookie_header(resp) -> str:
    [cookie] = [c for c in resp.headers.get_list("set-cookie") if c.startswith("tumble_session=")]
    return cookie.lower()


def test_the_cookie_is_not_secure_over_http(local_stack, client_from, callback_mocks):  # noqa: F811
    resp = client_from("192.168.50.20").get(
        "/auth/clerk/callback?code=c&state=s", headers={"host": "192.168.50.141:8085"}
    )
    assert resp.status_code == 303
    assert "secure" not in _session_cookie_header(resp)


def test_the_cookie_is_secure_when_the_public_url_is_https(
    local_stack, client_from, callback_mocks, monkeypatch  # noqa: F811
):
    """Behind a TLS-terminating proxy the request reaches uvicorn as http, so
    the configured https address of the host is what tells."""
    monkeypatch.setattr(settings, "web_public_url", "https://tumble.example.com")
    resp = client_from("192.168.50.20").get(
        "/auth/clerk/callback?code=c&state=s", headers={"host": "tumble.example.com"}
    )
    assert resp.status_code == 303
    assert "; secure" in _session_cookie_header(resp)


def test_the_cookie_is_secure_when_the_request_is_https(callback_mocks, session_factory):  # noqa: F811
    https = TestClient(app, base_url="https://testserver", follow_redirects=False)
    resp = https.get("/auth/clerk/callback?code=c&state=s")
    assert resp.status_code == 303
    assert "; secure" in _session_cookie_header(resp)
