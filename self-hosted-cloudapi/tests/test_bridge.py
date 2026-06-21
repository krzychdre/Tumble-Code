"""Tests for the live remote-control bridge (socket.io relay).

python-socketio has no in-process ASGI test client (no httpx-style transport),
so these exercise the relay's logic at the unit the rest of the suite uses:
the pure `ConnectionRegistry`, the handshake auth helpers, and the event/command
handlers called directly with `sio.emit`/`enter_room` stubbed and
`async_session_factory` pointed at the in-memory test engine.

The four guarantees under test (from the plan's Verification section):
  (a) an extension handshake with a valid JWT registers an instance;
  (b) a browser may `task:join` only a task it owns (foreign task rejected);
  (c) a `task:command` is relayed only to that user's own extension socket;
  (d) an extension Message event upserts a TaskMessage so history stays current.
"""

import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, func

from src.auth.jwt_issuer import issue_session_token
from src.auth.web_session import _serializer
from src.models.user import User, Session
from src.models.task import Task, TaskMessage
from src.realtime import sio as sio_module
from src.realtime.hub import ConnectionRegistry, registry
from src.realtime.sio import (
    _user_id_from_token,
    _cookie_from_environ,
    EVT_MESSAGE,
    EVT_INSTANCE_STATE,
    TASK_RELAYED_EVENT,
    TASK_RELAYED_COMMAND,
)


# --- fixtures --------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_registry():
    """The relay registry is a process singleton; reset it around each test."""
    registry._meta.clear()
    registry._ext_sid_by_user.clear()
    registry._instance_by_user.clear()
    yield
    registry._meta.clear()
    registry._ext_sid_by_user.clear()
    registry._instance_by_user.clear()


@pytest.fixture
def patch_session_factory(monkeypatch, session_factory):
    """Point the handlers' DB access at the in-memory test engine."""
    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    return session_factory


@pytest.fixture
def stub_emit(monkeypatch):
    """Replace the socket.io I/O methods so relays are captured, not sent."""
    emit = AsyncMock()
    enter = AsyncMock()
    leave = AsyncMock()
    monkeypatch.setattr(sio_module.sio, "emit", emit)
    monkeypatch.setattr(sio_module.sio, "enter_room", enter)
    monkeypatch.setattr(sio_module.sio, "leave_room", leave)
    return emit


async def _seed_user(db, user_id="user_test", email="t@example.com"):
    db.add(User(id=user_id, authentik_id=f"ak_{user_id}", email=email,
                first_name="Test", last_name="User"))
    await db.commit()


async def _seed_session(db, user_id, session_id="sess_web"):
    db.add(Session(id=session_id, user_id=user_id, is_active=True))
    await db.commit()
    return session_id


def _signed_cookie(session_id, user_id):
    return _serializer.dumps({"sid": session_id, "uid": user_id})


# --- pure registry ---------------------------------------------------------


def test_registry_pairs_browser_to_extension_and_clears_on_detach():
    reg = ConnectionRegistry()
    reg.attach("ext1", "extension", "u1")
    reg.register_extension("ext1", "u1", {"instanceId": "i1"})
    reg.attach("br1", "browser", "u1")

    assert reg.extension_sid("u1") == "ext1"
    assert reg.has_extension("u1") is True
    assert reg.instance("u1")["instanceId"] == "i1"
    assert reg.meta("br1")["role"] == "browser"

    # Detaching the extension clears the pairing; the browser is unaffected.
    reg.detach("ext1")
    assert reg.extension_sid("u1") is None
    assert reg.has_extension("u1") is False
    assert reg.instance("u1") is None
    assert reg.meta("br1")["role"] == "browser"


def test_registry_newest_extension_instance_wins():
    reg = ConnectionRegistry()
    reg.attach("ext_old", "extension", "u1")
    reg.register_extension("ext_old", "u1")
    reg.attach("ext_new", "extension", "u1")
    reg.register_extension("ext_new", "u1")
    assert reg.extension_sid("u1") == "ext_new"

    # A stale socket detaching must not clear the live pairing.
    reg.detach("ext_old")
    assert reg.extension_sid("u1") == "ext_new"


def test_registry_update_instance_state_merges():
    reg = ConnectionRegistry()
    reg.register_extension("ext1", "u1", {"instanceId": "i1"})
    reg.update_instance_state("u1", {"contextTokens": 1234, "isRunning": True})
    inst = reg.instance("u1")
    assert inst["instanceId"] == "i1"
    assert inst["contextTokens"] == 1234
    assert inst["isRunning"] is True


# --- handshake auth helpers ------------------------------------------------


def test_user_id_from_token_round_trips_jwt():
    token = issue_session_token("user_abc", expires_in=300)
    assert _user_id_from_token(token) == "user_abc"


def test_user_id_from_token_rejects_garbage():
    assert _user_id_from_token(None) is None
    assert _user_id_from_token("") is None
    assert _user_id_from_token("not-a-real-token") is None


def test_cookie_from_environ_extracts_session_cookie():
    environ = {"HTTP_COOKIE": "foo=bar; tumble_session=abc123; baz=qux"}
    assert _cookie_from_environ(environ) == "abc123"
    assert _cookie_from_environ({}) is None
    assert _cookie_from_environ({"HTTP_COOKIE": "other=1"}) is None


# --- (a) extension handshake registers an instance -------------------------


async def test_connect_extension_with_valid_jwt_attaches_and_registers(patch_session_factory):
    token = issue_session_token("user_ext", expires_in=300)
    ok = await sio_module.connect("extsid", {}, {"token": token})
    assert ok is True
    assert registry.meta("extsid") == {"role": "extension", "user_id": "user_ext"}

    res = await sio_module.on_extension_register("extsid", {"instanceId": "win-1"})
    assert res == {"success": True}
    assert registry.extension_sid("user_ext") == "extsid"
    assert registry.instance("user_ext")["instanceId"] == "win-1"


async def test_connect_extension_with_bad_token_is_rejected(patch_session_factory):
    assert await sio_module.connect("extsid", {}, {"token": "garbage"}) is False
    assert registry.meta("extsid") is None


# --- browser handshake via cookie ------------------------------------------


async def test_connect_browser_with_valid_cookie(patch_session_factory, db_session):
    await _seed_user(db_session, "user_web")
    sid_val = await _seed_session(db_session, "user_web")
    cookie = _signed_cookie(sid_val, "user_web")
    environ = {"HTTP_COOKIE": f"tumble_session={cookie}"}

    ok = await sio_module.connect("brsid", environ, None)
    assert ok is True
    assert registry.meta("brsid") == {"role": "browser", "user_id": "user_web"}


async def test_connect_browser_without_cookie_is_rejected(patch_session_factory):
    assert await sio_module.connect("brsid", {}, None) is False
    assert registry.meta("brsid") is None


# --- (b) task:join is ownership-checked ------------------------------------


async def test_task_join_only_owned_task(patch_session_factory, db_session, stub_emit):
    await _seed_user(db_session, "owner")
    await _seed_user(db_session, "stranger", email="s@example.com")
    db_session.add(Task(id="task-own", user_id="owner"))
    db_session.add(Task(id="task-foreign", user_id="stranger"))
    await db_session.commit()

    registry.attach("brsid", "browser", "owner")

    ok = await sio_module.on_task_join("brsid", {"taskId": "task-own"})
    assert ok["success"] is True
    assert ok["taskId"] == "task-own"

    foreign = await sio_module.on_task_join("brsid", {"taskId": "task-foreign"})
    assert foreign == {"success": False, "error": "forbidden"}

    missing = await sio_module.on_task_join("brsid", {"taskId": "nope"})
    assert missing == {"success": False, "error": "forbidden"}


# --- (c) task:command relayed only to the owner's extension ----------------


async def test_task_command_relayed_only_to_owner_extension(
    patch_session_factory, db_session, stub_emit
):
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()

    # Owner has a browser AND a registered extension; a different user also has one.
    registry.attach("br_owner", "browser", "owner")
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")
    registry.attach("ext_other", "extension", "stranger")
    registry.register_extension("ext_other", "stranger")

    cmd = {"taskId": "task-own", "type": "stop_task", "timestamp": 1}
    res = await sio_module.on_task_command("br_owner", cmd)
    assert res == {"success": True}

    # Relayed exactly once, only to the owner's extension socket.
    stub_emit.assert_awaited_once_with(TASK_RELAYED_COMMAND, cmd, to="ext_owner")


async def test_task_command_on_foreign_task_is_forbidden(
    patch_session_factory, db_session, stub_emit
):
    await _seed_user(db_session, "owner")
    await _seed_user(db_session, "stranger", email="s@example.com")
    db_session.add(Task(id="task-foreign", user_id="stranger"))
    await db_session.commit()

    registry.attach("br_owner", "browser", "owner")
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")

    res = await sio_module.on_task_command(
        "br_owner", {"taskId": "task-foreign", "type": "stop_task"}
    )
    assert res == {"success": False, "error": "forbidden"}
    stub_emit.assert_not_awaited()


async def test_task_command_when_extension_offline(
    patch_session_factory, db_session, stub_emit
):
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()

    registry.attach("br_owner", "browser", "owner")  # no extension registered

    res = await sio_module.on_task_command(
        "br_owner", {"taskId": "task-own", "type": "stop_task"}
    )
    assert res == {"success": False, "error": "extension offline"}
    stub_emit.assert_not_awaited()


# --- (d) extension Message event relays + persists -------------------------


async def test_task_event_message_relays_and_upserts(
    patch_session_factory, db_session, session_factory, stub_emit
):
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()

    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")

    message = {"ts": 42, "type": "say", "say": "text", "text": "hello from the task"}
    event = {"taskId": "task-own", "type": EVT_MESSAGE, "message": message}
    await sio_module.on_task_event("ext_owner", event)

    # Relayed to the task room for any watching browser...
    stub_emit.assert_awaited_once_with(TASK_RELAYED_EVENT, event, room="task:task-own")

    # ...and persisted so /app/tasks/{id} history stays current.
    async with session_factory() as s:
        rows = (
            await s.execute(
                select(TaskMessage).where(TaskMessage.task_id == "task-own")
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].message_ts == 42
        assert "hello from the task" in rows[0].message_data


async def test_task_event_message_upsert_is_idempotent_by_ts(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """A streaming message arrives partial→final under one ts; it must update the
    same row, not append duplicates."""
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()
    registry.attach("ext_owner", "extension", "owner")

    base = {"taskId": "task-own", "type": EVT_MESSAGE}
    await sio_module.on_task_event(
        "ext_owner", {**base, "message": {"ts": 7, "type": "say", "say": "text",
                                          "text": "partial", "partial": True}}
    )
    await sio_module.on_task_event(
        "ext_owner", {**base, "message": {"ts": 7, "type": "say", "say": "text",
                                          "text": "partial then final"}}
    )

    async with session_factory() as s:
        n = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(TaskMessage.task_id == "task-own")
            )
        ).scalar_one()
        assert n == 1
        row = (
            await s.execute(select(TaskMessage).where(TaskMessage.task_id == "task-own"))
        ).scalar_one()
        assert "final" in row.message_data


async def test_task_event_reasoning_stream_collapses_and_finalizes(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """Reproduces the stuck-spinner bug: many rapid `partial:true` reasoning
    chunks followed by a `partial:false` finalize must yield exactly one row,
    stored with partial=false (so the web view never spins forever)."""
    import json

    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()
    registry.attach("ext_owner", "extension", "owner")

    base = {"taskId": "task-own", "type": EVT_MESSAGE}
    for i in range(1, 6):
        await sio_module.on_task_event(
            "ext_owner",
            {**base, "message": {"ts": 42, "type": "say", "say": "reasoning",
                                 "text": "thinking " * i, "partial": True}},
        )
    # Finalizer (TaskStreamProcessor sets partial=false on the reasoning row).
    await sio_module.on_task_event(
        "ext_owner",
        {**base, "message": {"ts": 42, "type": "say", "say": "reasoning",
                             "text": "thinking thinking thinking thinking thinking",
                             "partial": False}},
    )

    async with session_factory() as s:
        rows = (
            await s.execute(select(TaskMessage).where(TaskMessage.task_id == "task-own"))
        ).scalars().all()
        assert len(rows) == 1
        assert json.loads(rows[0].message_data).get("partial") is False


async def test_task_event_upsert_never_regresses_to_shorter_partial(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """The concurrent per-event upserts for one ts serialize on the unique-index
    row lock, so the *last to commit* — non-deterministically an early, short
    partial — would otherwise win and freeze the row at truncated text. The
    monotonic length guard must reject any payload shorter than what is stored,
    so the full/finalized text is preserved regardless of commit order."""
    import json

    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()
    registry.attach("ext_owner", "extension", "owner")

    base = {"taskId": "task-own", "type": EVT_MESSAGE}
    full = "The user says they need a complete summary of every recent change."
    # Final/full payload commits first...
    await sio_module.on_task_event(
        "ext_owner",
        {**base, "message": {"ts": 99, "type": "say", "say": "reasoning",
                             "text": full, "partial": False}},
    )
    # ...then an early, short partial for the same ts arrives late (the race).
    await sio_module.on_task_event(
        "ext_owner",
        {**base, "message": {"ts": 99, "type": "say", "say": "reasoning",
                             "text": "The user says", "partial": True}},
    )

    async with session_factory() as s:
        rows = (
            await s.execute(select(TaskMessage).where(TaskMessage.task_id == "task-own"))
        ).scalars().all()
        assert len(rows) == 1
        stored = json.loads(rows[0].message_data)
        assert stored["text"] == full
        assert stored.get("partial") is False


async def test_task_event_instance_state_updates_registry(
    patch_session_factory, db_session, stub_emit
):
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")

    event = {
        "taskId": "task-own",
        "type": EVT_INSTANCE_STATE,
        "isRunning": True,
        "contextTokens": 5000,
        "contextWindow": 200000,
    }
    await sio_module.on_task_event("ext_owner", event)

    stub_emit.assert_awaited_once_with(TASK_RELAYED_EVENT, event, room="task:task-own")
    inst = registry.instance("owner")
    assert inst["isRunning"] is True
    assert inst["contextTokens"] == 5000
    assert inst["contextWindow"] == 200000


async def test_task_event_from_non_extension_is_ignored(stub_emit):
    registry.attach("br1", "browser", "owner")
    await sio_module.on_task_event("br1", {"taskId": "t", "type": EVT_MESSAGE,
                                           "message": {"ts": 1}})
    stub_emit.assert_not_awaited()
