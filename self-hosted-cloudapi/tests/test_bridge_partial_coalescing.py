"""The live bridge coalesces streamed partial rows before they reach the database (P11).

A streaming message (reasoning, text, a command's output) is re-sent by the
extension with its whole accumulated text on every chunk, all under one
``ts``, and the bridge used to open a session and commit once per chunk. Only
the latest revision of a row matters, so a partial is now held for a short
window per ``(task, ts)`` and written once; every chunk is still relayed to
watching browsers at once.

Invariants pinned here:
- partials for one ``(task, ts)`` inside the window are written with one commit,
  holding the fullest revision (the database's own "a partial never shrinks
  the row" rule);
- a final is written at once, replaces a held partial of its ``ts`` (which is
  never written) and takes the task's other held partials along in the same
  transaction, so nothing written earlier than it today lands later;
- held partials are written when their socket disconnects and when the app
  shuts down, so nothing is lost;
- a partial for a task whose owner is not known yet is written at once (the
  write is what creates the task and answers the ownership question).
"""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event, select

from src.models.task import Task, TaskMessage
from src.models.user import User
from src.realtime import sio as sio_module
from src.realtime.hub import registry
from src.realtime.sio import EVT_MESSAGE, TASK_RELAYED_EVENT

OWNER = "owner"
SID = "ext_owner"
TASK = "task-stream"


@pytest.fixture(autouse=True)
def _clean_registry():
    for table in (registry._meta, registry._ext_sid_by_user, registry._instance_by_user,
                  registry._task_access_by_sid):
        table.clear()
    yield
    for table in (registry._meta, registry._ext_sid_by_user, registry._instance_by_user,
                  registry._task_access_by_sid):
        table.clear()


@pytest.fixture
def emit(monkeypatch):
    stub = AsyncMock()
    monkeypatch.setattr(sio_module.sio, "emit", stub)
    return stub


@pytest.fixture
def commits(test_engine):
    """Every transaction committed on the test database."""
    seen = []

    def on_commit(conn):
        seen.append(conn)

    event.listen(test_engine.sync_engine, "commit", on_commit)
    yield seen
    event.remove(test_engine.sync_engine, "commit", on_commit)


@pytest.fixture
def delay(monkeypatch):
    """Set the coalescing window (seconds) for one test."""

    def set_delay(seconds):
        monkeypatch.setattr(sio_module.partial_messages, "delay", seconds)

    return set_delay


@pytest.fixture
async def owned_task(monkeypatch, session_factory, db_session):
    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    db_session.add(User(id=OWNER, authentik_id="ak_owner", email="o@example.com"))
    await db_session.commit()
    db_session.add(Task(id=TASK, user_id=OWNER))
    await db_session.commit()
    registry.attach(SID, "extension", OWNER)
    registry.register_extension(SID, OWNER)
    # The socket already knows it owns the task (every chunk after the first).
    registry.remember_task_access(SID, TASK, True)
    yield
    sio_module.partial_messages.discard()


def _chunk(ts, text, partial=True, task_id=TASK):
    message = {"ts": ts, "type": "say", "say": "reasoning", "text": text}
    if partial is not None:
        message["partial"] = partial
    return {"taskId": task_id, "type": EVT_MESSAGE, "message": message}


async def _rows(session_factory, task_id=TASK):
    async with session_factory() as s:
        rows = (
            await s.execute(
                select(TaskMessage.message_ts, TaskMessage.message_data)
                .where(TaskMessage.task_id == task_id)
                .order_by(TaskMessage.message_ts)
            )
        ).all()
    return [(ts, json.loads(data)) for ts, data in rows]


async def test_partials_for_one_ts_within_the_window_coalesce_into_one_commit(
    owned_task, emit, commits, delay, session_factory
):
    delay(0.05)
    for i in range(1, 6):
        await sio_module.on_task_event(SID, _chunk(42, "thinking " * i))

    # Every chunk reaches a watching browser at once...
    assert emit.await_count == 5
    # ...but none of them has been written yet.
    assert commits == []

    await asyncio.sleep(0.2)

    assert len(commits) == 1
    rows = await _rows(session_factory)
    assert rows == [(42, {"ts": 42, "type": "say", "say": "reasoning",
                          "text": "thinking " * 5, "partial": True})]


async def test_the_held_revision_is_the_fullest_one(owned_task, emit, commits, delay, session_factory):
    """Chunks can be handled out of order; like the database's own upsert
    guard, a shorter partial never replaces a longer one."""
    delay(0.05)
    await sio_module.on_task_event(SID, _chunk(42, "The user says they need"))
    await sio_module.on_task_event(SID, _chunk(42, "The user says"))

    await asyncio.sleep(0.2)

    assert [m["text"] for _ts, m in await _rows(session_factory)] == ["The user says they need"]


async def test_a_final_is_written_at_once_and_supersedes_held_partials(
    owned_task, emit, commits, delay, session_factory
):
    delay(10)
    for i in range(1, 4):
        await sio_module.on_task_event(SID, _chunk(42, "thinking " * i))
    assert commits == []

    await sio_module.on_task_event(SID, _chunk(42, "thinking thinking thinking done", partial=False))

    assert len(commits) == 1
    rows = await _rows(session_factory)
    assert len(rows) == 1
    assert rows[0][1]["text"] == "thinking thinking thinking done"
    assert rows[0][1]["partial"] is False
    assert sio_module.partial_messages.pending() == 0


async def test_a_final_takes_the_tasks_other_held_partials_along(
    owned_task, emit, commits, delay, session_factory
):
    """A held partial of an earlier ts is written in the final's transaction,
    so the final never lands in the database before an earlier row."""
    delay(10)
    await sio_module.on_task_event(SID, _chunk(41, "earlier, still streaming"))
    await sio_module.on_task_event(SID, _chunk(42, "the answer", partial=False))

    assert len(commits) == 1
    assert [(ts, m["text"]) for ts, m in await _rows(session_factory)] == [
        (41, "earlier, still streaming"),
        (42, "the answer"),
    ]
    assert sio_module.partial_messages.pending() == 0


async def test_a_final_without_the_partial_flag_is_also_immediate(
    owned_task, emit, commits, delay, session_factory
):
    delay(10)
    await sio_module.on_task_event(SID, _chunk(42, "said once", partial=None))

    assert len(commits) == 1
    assert [m["text"] for _ts, m in await _rows(session_factory)] == ["said once"]


async def test_a_disconnect_writes_the_sockets_held_partials(
    owned_task, emit, commits, delay, session_factory
):
    delay(10)
    await sio_module.on_task_event(SID, _chunk(42, "cut off mid-stream"))
    assert await _rows(session_factory) == []

    await sio_module.disconnect(SID)

    assert [m["text"] for _ts, m in await _rows(session_factory)] == ["cut off mid-stream"]
    assert sio_module.partial_messages.pending() == 0


async def test_shutdown_writes_every_held_partial(
    owned_task, emit, delay, session_factory, monkeypatch, tmp_path
):
    from sqlalchemy.ext.asyncio import create_async_engine

    import src.database
    from src import main as main_module
    from src.main import app, lifespan

    throwaway = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'lifespan.db'}")
    monkeypatch.setattr(src.database, "engine", throwaway)
    monkeypatch.setattr(main_module.settings, "retention_sweep_enabled", False)

    delay(10)
    await sio_module.on_task_event(SID, _chunk(42, "server going down"))
    assert await _rows(session_factory) == []

    async with lifespan(app):
        pass

    assert [m["text"] for _ts, m in await _rows(session_factory)] == ["server going down"]
    assert sio_module.partial_messages.pending() == 0


async def test_a_partial_for_a_task_of_unknown_owner_is_written_at_once(
    monkeypatch, session_factory, db_session, emit, commits, delay
):
    """The first chunk of a new task is what creates its row and tells the
    relay whose task it is, so it cannot wait."""
    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    db_session.add(User(id=OWNER, authentik_id="ak_owner", email="o@example.com"))
    await db_session.commit()
    registry.attach(SID, "extension", OWNER)
    delay(10)

    event_ = _chunk(7, "first words", task_id="task-new")
    await sio_module.on_task_event(SID, event_)

    emit.assert_awaited_once_with(TASK_RELAYED_EVENT, event_, room="task:task-new")
    assert [m["text"] for _ts, m in await _rows(session_factory, "task-new")] == ["first words"]
    assert registry.task_access(SID, "task-new") is True
