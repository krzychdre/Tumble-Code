"""A browser socket of the live bridge ends with the web session it was opened with.

The socket is authenticated once, at its handshake, by the session cookie.
Signing out (or the session being deactivated or expiring) used to leave an
open tab subscribed to its tasks' live events. Now the sign-out closes the
sockets of that session, and every task:join and task:command checks the
session again.

As in tests/test_bridge.py the handlers run directly against the test
database; only socket.io's own network calls (disconnect, room entry) are
replaced by recorders, since there is no in-process socket.io client.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from src.auth.web_session import _serializer
from src.models.task import Task
from src.models.user import Session, User
from src.realtime import sio as sio_module
from src.realtime.hub import registry

OWN = "http://testserver"


@pytest.fixture(autouse=True)
def _clean_registry():
    registry.reset()
    yield
    registry.reset()


@pytest.fixture
def bridge(monkeypatch, session_factory):
    """The handlers on the test database, with socket.io's network calls recorded."""
    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    closed: list[str] = []

    async def disconnect(sid, *args, **kwargs):
        closed.append(sid)

    async def enter_room(sid, room, *args, **kwargs):
        pass

    monkeypatch.setattr(sio_module.sio, "disconnect", disconnect)
    monkeypatch.setattr(sio_module.sio, "enter_room", enter_room)
    return closed


async def _seed(db, user_id="user_web", sessions=("sess_a", "sess_b")):
    db.add(User(id=user_id, authentik_id=f"ak_{user_id}", email=f"{user_id}@x.org"))
    await db.flush()
    for session_id in sessions:
        db.add(Session(id=session_id, user_id=user_id, is_active=True))
    db.add(Task(id="task-1", user_id=user_id))
    await db.commit()


def _cookie(session_id, user_id="user_web"):
    return _serializer.dumps({"sid": session_id, "uid": user_id})


async def _open_tab(sid, session_id):
    environ = {"HTTP_COOKIE": f"tumble_session={_cookie(session_id)}"}
    assert await sio_module.connect(sid, environ, None) is True


async def test_signing_out_closes_the_sockets_of_that_session_only(
    bridge, client, db_session
):
    await _seed(db_session)
    await _open_tab("tab-a1", "sess_a")
    await _open_tab("tab-a2", "sess_a")
    await _open_tab("tab-b", "sess_b")

    client.cookies.set("tumble_session", _cookie("sess_a"))
    resp = client.post("/app/logout", headers={"origin": OWN}, follow_redirects=False)

    assert resp.status_code == 303
    assert sorted(bridge) == ["tab-a1", "tab-a2"]
    assert registry.meta("tab-a1") is None and registry.meta("tab-a2") is None
    assert registry.meta("tab-b") is not None


async def test_a_socket_whose_session_was_deactivated_cannot_join_or_command(
    bridge, db_session, session_factory
):
    await _seed(db_session)
    await _open_tab("tab", "sess_a")
    assert (await sio_module.on_task_join("tab", {"taskId": "task-1"}))["success"]

    async with session_factory() as s:
        await s.execute(
            update(Session).where(Session.id == "sess_a").values(is_active=False)
        )
        await s.commit()

    assert await sio_module.on_task_join("tab", {"taskId": "task-1"}) == {
        "success": False,
        "error": "unauthenticated",
    }
    assert bridge == ["tab"]
    assert registry.meta("tab") is None


async def test_a_socket_whose_session_expired_cannot_send_commands(
    bridge, db_session, session_factory
):
    await _seed(db_session)
    await _open_tab("tab", "sess_a")
    async with session_factory() as s:
        await s.execute(
            update(Session)
            .where(Session.id == "sess_a")
            .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        )
        await s.commit()

    answer = await sio_module.on_task_command(
        "tab", {"taskId": "task-1", "type": "cancel"}
    )

    assert answer == {"success": False, "error": "unauthenticated"}
    assert bridge == ["tab"]


async def test_ending_a_session_without_sockets_closes_nothing(bridge, db_session):
    await _seed(db_session)
    await _open_tab("tab-b", "sess_b")

    await sio_module.end_web_session("sess_a")

    assert bridge == []
    assert registry.meta("tab-b") is not None
