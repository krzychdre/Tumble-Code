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
    registry._task_access_by_sid.clear()
    yield
    registry._meta.clear()
    registry._ext_sid_by_user.clear()
    registry._instance_by_user.clear()
    registry._task_access_by_sid.clear()


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


async def test_connect_browser_outside_the_allowlist_is_rejected_despite_a_valid_cookie(
    patch_session_factory, db_session, monkeypatch
):
    """The client is read off the ASGI scope. engine.io's own REMOTE_ADDR is a
    constant "127.0.0.1", so checking that would wave every browser through as
    local; the environ below carries it exactly as engine.io builds it."""
    from config.settings import settings
    from src.auth import network_access

    monkeypatch.setattr(settings, "web_allowed_networks", "192.168.50.0/24")
    monkeypatch.setattr(network_access, "container_gateway", lambda: None)
    await _seed_user(db_session, "user_web")
    sid_val = await _seed_session(db_session, "user_web")
    cookie = _signed_cookie(sid_val, "user_web")

    def environ(client):
        return {
            "HTTP_COOKIE": f"tumble_session={cookie}",
            "REMOTE_ADDR": "127.0.0.1",
            "asgi.scope": {"type": "websocket", "client": (client, 40000)},
        }

    assert await sio_module.connect("outsider", environ("192.168.51.7"), None) is False
    assert registry.meta("outsider") is None
    assert await sio_module.connect("insider", environ("192.168.50.20"), None) is True
    assert registry.meta("insider") == {"role": "browser", "user_id": "user_web"}
    # The extension authenticates with its token and is not the panel.
    token = issue_session_token("user_web", expires_in=300)
    assert await sio_module.connect("ext", environ("192.168.51.7"), {"token": token}) is True


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


async def test_task_event_stamps_workspace_path_from_registered_instance(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """The live bridge stamps the registered instance's workspacePath on the task
    it creates, so the web view can show which project/worktree it ran in."""
    await _seed_user(db_session, "owner")

    ws = "/home/krzych/Projekty/QUB-IT/Roo-Code"
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner", {"workspacePath": ws})

    event = {
        "taskId": "task-ws",
        "type": EVT_MESSAGE,
        "message": {"ts": 1, "type": "say", "say": "text", "text": "hi"},
    }
    await sio_module.on_task_event("ext_owner", event)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-ws"))).scalar_one()
        assert task.workspace_path == ws


async def test_task_event_prefers_event_workspace_path_over_registry(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """When several windows share one cloud account the registry holds only the
    most recently registered window's path. The originating window stamps its own
    worktree root on the event, which must take precedence so the task is
    attributed to the project it actually ran in."""
    await _seed_user(db_session, "owner")

    # Registry points at a *different* window (the last to register).
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension(
        "ext_owner", "owner", {"workspacePath": "/home/krzych/Projekty/septicoBackend"}
    )

    event_ws = "/home/krzych/Projekty/lids-uniform-api"
    await sio_module.on_task_event(
        "ext_owner",
        {
            "taskId": "task-evt-ws",
            "type": EVT_MESSAGE,
            "workspacePath": event_ws,
            "message": {"ts": 1, "type": "say", "say": "text", "text": "hi"},
        },
    )

    async with session_factory() as s:
        task = (
            await s.execute(select(Task).where(Task.id == "task-evt-ws"))
        ).scalar_one()
        assert task.workspace_path == event_ws


async def test_task_event_backfills_workspace_path_on_legacy_null_task(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """A task that predates workspace tracking (workspace_path NULL) gets it filled
    the first time the bridge reports a path — set once, never overwritten."""
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-legacy", user_id="owner", workspace_path=None))
    await db_session.commit()

    ws = "/home/krzych/Projekty/QUB-IT/Roo-Code"
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner", {"workspacePath": ws})

    await sio_module.on_task_event(
        "ext_owner",
        {
            "taskId": "task-legacy",
            "type": EVT_MESSAGE,
            "message": {"ts": 1, "type": "say", "say": "text", "text": "hi"},
        },
    )

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-legacy"))).scalar_one()
        assert task.workspace_path == ws

    # A later event from a different worktree must NOT move the task.
    registry.register_extension("ext_owner", "owner", {"workspacePath": "/some/other/root"})
    await sio_module.on_task_event(
        "ext_owner",
        {
            "taskId": "task-legacy",
            "type": EVT_MESSAGE,
            "message": {"ts": 2, "type": "say", "say": "text", "text": "more"},
        },
    )
    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-legacy"))).scalar_one()
        assert task.workspace_path == ws


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


# --- DEF-S10: events for a task the sender does not own ----------------------


async def _victim_task_with_one_message(db, session_factory):
    await _seed_user(db, "victim", "victim@example.com")
    await _seed_user(db, "attacker", "attacker@example.com")
    db.add(Task(id="task-victim", user_id="victim"))
    await db.commit()
    registry.attach("ext_victim", "extension", "victim")
    registry.register_extension("ext_victim", "victim")
    original = {"ts": 1, "type": "say", "say": "text", "text": "the real conversation"}
    await sio_module.on_task_event(
        "ext_victim", {"taskId": "task-victim", "type": EVT_MESSAGE, "message": original}
    )
    async with session_factory() as s:
        return (
            await s.execute(
                select(TaskMessage.message_data).where(TaskMessage.task_id == "task-victim")
            )
        ).scalars().all()


@pytest.mark.parametrize(
    "event",
    [
        {"type": EVT_MESSAGE, "message": {"ts": 1, "type": "say", "say": "text",
                                          "text": "forged by another user"}},
        {"type": EVT_MESSAGE, "message": {"ts": 2, "type": "say", "say": "text",
                                          "text": "forged by another user"}},
        {"type": EVT_INSTANCE_STATE, "isRunning": True, "mode": "forged"},
        {"type": "taskInteractive"},
    ],
    ids=["message-same-ts", "message-new-ts", "instance-state", "task-interactive"],
)
async def test_task_event_for_a_foreign_task_is_neither_relayed_nor_saved(
    patch_session_factory, db_session, session_factory, stub_emit, event
):
    """DEF-S10: the relay used to broadcast into the task room before any
    ownership check, so any signed-in extension could push forged messages,
    mode switches or instance state into another user's live view (the save
    was refused later, the broadcast had already happened)."""
    before = await _victim_task_with_one_message(db_session, session_factory)
    stub_emit.reset_mock()

    registry.attach("ext_attacker", "extension", "attacker")
    registry.register_extension("ext_attacker", "attacker")
    await sio_module.on_task_event("ext_attacker", {"taskId": "task-victim", **event})

    stub_emit.assert_not_awaited()
    async with session_factory() as s:
        after = (
            await s.execute(
                select(TaskMessage.message_data).where(TaskMessage.task_id == "task-victim")
            )
        ).scalars().all()
        owner = (
            await s.execute(select(Task.user_id).where(Task.id == "task-victim"))
        ).scalar_one()
    assert after == before
    assert owner == "victim"


async def test_first_message_of_an_unknown_task_creates_it_then_relays(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """A brand-new task has no row until its first message: the save creates
    it, owned by the sender, and the event is relayed like any owned one."""
    await _seed_user(db_session, "owner")
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")

    event = {"taskId": "task-new", "type": EVT_MESSAGE,
             "message": {"ts": 7, "type": "say", "say": "text", "text": "first words"}}
    await sio_module.on_task_event("ext_owner", event)

    stub_emit.assert_awaited_once_with(TASK_RELAYED_EVENT, event, room="task:task-new")
    async with session_factory() as s:
        owner = (await s.execute(select(Task.user_id).where(Task.id == "task-new"))).scalar_one()
    assert owner == "owner"


async def test_state_event_for_an_unknown_task_is_held_until_the_task_exists(
    patch_session_factory, db_session, session_factory, stub_emit
):
    """A non-message event cannot create a task. While no row exists nobody can
    have joined the room (task:join requires ownership), so it is not relayed;
    "unknown" must not be cached, or the task would stay dark once its row is
    created by the first message or by a backfill."""
    await _seed_user(db_session, "owner")
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")

    state = {"taskId": "task-later", "type": EVT_INSTANCE_STATE, "isRunning": True}
    await sio_module.on_task_event("ext_owner", state)
    stub_emit.assert_not_awaited()
    # The sender's own instance record still follows its state.
    assert registry.instance("owner")["isRunning"] is True

    # The row appears later (here: created by a backfill on another connection).
    db_session.add(Task(id="task-later", user_id="owner"))
    await db_session.commit()

    await sio_module.on_task_event("ext_owner", state)
    stub_emit.assert_awaited_once_with(TASK_RELAYED_EVENT, state, room="task:task-later")


async def test_task_event_ownership_is_looked_up_once_per_socket_and_task(
    monkeypatch, session_factory, db_session, stub_emit
):
    """The relay is a hot path (every streamed chunk): once a socket's
    ownership of a task is known, further non-message events open no database
    session, and a message event opens only the one its save needs."""
    await _seed_user(db_session, "owner")
    db_session.add(Task(id="task-own", user_id="owner"))
    await db_session.commit()
    registry.attach("ext_owner", "extension", "owner")
    registry.register_extension("ext_owner", "owner")

    opened = 0

    def counting_factory():
        nonlocal opened
        opened += 1
        return session_factory()

    monkeypatch.setattr(sio_module, "async_session_factory", counting_factory)

    state = {"taskId": "task-own", "type": EVT_INSTANCE_STATE, "isRunning": True}
    await sio_module.on_task_event("ext_owner", state)
    assert opened == 1  # the ownership lookup
    for _ in range(3):
        await sio_module.on_task_event("ext_owner", state)
    assert opened == 1

    for ts in (10, 11, 12):
        await sio_module.on_task_event(
            "ext_owner",
            {"taskId": "task-own", "type": EVT_MESSAGE,
             "message": {"ts": ts, "type": "say", "say": "text", "text": "chunk"}},
        )
    assert opened == 4  # one save per message, no extra lookup
    assert stub_emit.await_count == 7


def test_registry_task_access_cache_is_per_socket_and_dropped_on_detach():
    r = ConnectionRegistry()
    r.attach("ext1", "extension", "u1")
    r.attach("ext2", "extension", "u1")
    r.remember_task_access("ext1", "t1", True)
    r.remember_task_access("ext1", "t2", False)

    assert r.task_access("ext1", "t1") is True
    assert r.task_access("ext1", "t2") is False
    assert r.task_access("ext1", "t3") is None
    assert r.task_access("ext2", "t1") is None

    r.detach("ext1")
    assert r.task_access("ext1", "t1") is None


def test_registry_task_access_cache_is_bounded_per_socket():
    r = ConnectionRegistry()
    r.attach("ext1", "extension", "u1")
    for i in range(ConnectionRegistry.TASK_ACCESS_CACHE_SIZE + 10):
        r.remember_task_access("ext1", f"t{i}", True)
    assert len(r._task_access_by_sid["ext1"]) == ConnectionRegistry.TASK_ACCESS_CACHE_SIZE
    assert r.task_access("ext1", "t0") is None
    last = ConnectionRegistry.TASK_ACCESS_CACHE_SIZE + 9
    assert r.task_access("ext1", f"t{last}") is True


def test_registry_ignores_task_access_for_a_detached_socket():
    """A handler that finishes after its socket disconnected must not
    resurrect a cache entry that nothing would ever clear."""
    r = ConnectionRegistry()
    r.remember_task_access("gone", "t1", True)
    assert r.task_access("gone", "t1") is None
    assert "gone" not in r._task_access_by_sid
