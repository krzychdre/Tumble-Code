"""Two writers creating the same task row at once (DEF-C48).

The live bridge persists every chunk in its own transaction, so the first two
chunks of a new task can run concurrently. Both used to look the task up, both
found nothing, and both inserted it: the loser died on the primary key of
``tasks`` (``duplicate key value violates unique constraint "tasks_pkey"`` in
the live server log) and its message was lost. A backfill racing a live chunk
had the same problem.

The race is replayed deterministically: a statement hook lets the lookup run,
then, right before the INSERT INTO tasks of the writer under test, commits the
same row from a second connection, which is exactly the interleaving of two
concurrent first chunks. A file database is used so that second connection is
a real, separate one (the shared in-memory engine of conftest has only one).
"""

import json
import sqlite3

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.database import Base
from src.models.task import Task, TaskMessage
from src.models.user import User
from src.services import telemetry_service
from src.services.telemetry_service import (
    TaskNotOwnedError,
    backfill_messages,
    upsert_task_message,
)

TASK = "task-race"
OWNER = "owner"
OTHER = "someone-else"


@pytest.fixture
async def race(tmp_path):
    """A file-backed engine plus a switch that makes a rival writer win the race."""
    db_file = tmp_path / "race.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        for user_id in (OWNER, OTHER):
            s.add(User(id=user_id, authentik_id=f"ak_{user_id}", email=f"{user_id}@example.com"))
        await s.commit()

    rival = {"owner": None, "fired": False}

    def before(conn, cursor, statement, parameters, context, executemany):
        if rival["owner"] is None or rival["fired"]:
            return
        if not statement.lstrip().upper().startswith("INSERT INTO TASKS"):
            return
        rival["fired"] = True
        # The other writer's transaction: it inserted the task and committed
        # while ours was between its lookup and its own insert.
        with sqlite3.connect(db_file) as other:
            other.execute(
                "INSERT INTO tasks (id, user_id) VALUES (?, ?)", (TASK, rival["owner"])
            )

    event.listen(engine.sync_engine, "before_cursor_execute", before)
    try:
        yield factory, rival
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", before)
        await engine.dispose()


@pytest.fixture
def link_calls(monkeypatch):
    calls: list[str] = []
    original = telemetry_service._link_task_tree

    async def counting(db, task_id):
        calls.append(task_id)
        await original(db, task_id)

    monkeypatch.setattr(telemetry_service, "_link_task_tree", counting)
    return calls


def _final(ts: int, text: str) -> dict:
    return {"ts": ts, "type": "say", "say": "text", "text": text}


async def _stored(factory) -> list[dict]:
    async with factory() as s:
        rows = await s.execute(
            select(TaskMessage.message_data)
            .where(TaskMessage.task_id == TASK)
            .order_by(TaskMessage.message_ts)
        )
        return [json.loads(payload) for (payload,) in rows.all()]


async def test_a_chunk_that_loses_the_task_row_race_still_persists(race, link_calls):
    factory, rival = race
    rival["owner"] = OWNER

    async with factory() as s:
        owned = await upsert_task_message(s, TASK, OWNER, _final(1, "hello"))
        await s.commit()

    assert rival["fired"], "the hook never saw the task insert"
    assert owned is True
    assert await _stored(factory) == [_final(1, "hello")]
    async with factory() as s:
        tasks = (await s.execute(select(func.count(Task.id)).where(Task.id == TASK))).scalar_one()
        task = (await s.execute(select(Task).where(Task.id == TASK))).scalar_one()
    assert tasks == 1
    assert task.user_id == OWNER
    # The winner of the race created the row, so linking it into the tree is
    # the winner's job (CAPI-M11: link only when this call inserted the row).
    assert link_calls == []


async def test_a_race_lost_to_another_users_task_writes_nothing(race):
    factory, rival = race
    rival["owner"] = OTHER

    async with factory() as s:
        owned = await upsert_task_message(s, TASK, OWNER, _final(1, "hello"))
        await s.commit()

    assert rival["fired"]
    assert owned is False
    assert await _stored(factory) == []
    async with factory() as s:
        task = (await s.execute(select(Task).where(Task.id == TASK))).scalar_one()
    assert task.user_id == OTHER


async def test_a_chunk_that_creates_the_row_links_it_once(race, link_calls):
    factory, _rival = race  # no rival: this call inserts the row itself

    async with factory() as s:
        assert await upsert_task_message(s, TASK, OWNER, _final(1, "a")) is True
        assert await upsert_task_message(s, TASK, OWNER, _final(2, "b")) is True
        await s.commit()

    assert link_calls == [TASK]
    assert [m["text"] for m in await _stored(factory)] == ["a", "b"]


async def test_a_backfill_that_loses_the_task_row_race_still_uploads(race):
    factory, rival = race
    rival["owner"] = OWNER
    messages = [_final(1, "first"), _final(2, "second")]

    async with factory() as s:
        await backfill_messages(s, TASK, OWNER, messages)
        await s.commit()

    assert rival["fired"]
    assert await _stored(factory) == messages


async def test_a_backfill_that_loses_the_race_to_another_user_is_refused(race):
    factory, rival = race
    rival["owner"] = OTHER

    async with factory() as s:
        with pytest.raises(TaskNotOwnedError):
            await backfill_messages(s, TASK, OWNER, [_final(1, "first")])

    assert await _stored(factory) == []
