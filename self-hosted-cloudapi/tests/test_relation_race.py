"""Two telemetry events recording the same subtask link at once.

Every event of a subtask names its parent (``taskId`` + ``parentTaskId``), and
several of them arrive together, each in its own request. Two could both miss
the lookup in ``record_relation`` and both insert; the loser died on
``task_relations_pkey`` (``duplicate key value violates unique constraint`` in
the live server log, 2026-10-09) and its whole ``POST /api/events`` answered
500, so the event itself was lost until the client retried it.

The race is replayed the way tests/test_task_row_race.py does it: right before
the INSERT INTO task_relations of the writer under test, a second connection
commits the same relation.
"""

import sqlite3

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.database import Base
from src.models.event import TelemetryEvent
from src.models.relation import TaskRelation
from src.models.user import User
from src.services.task_tree import record_relation
from src.services.telemetry_service import record_event

CHILD = "child-task"
PARENT = "parent-task"
OWNER = "owner"


@pytest.fixture
async def race(tmp_path):
    db_file = tmp_path / "race.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        s.add(User(id=OWNER, authentik_id=f"ak_{OWNER}", email=f"{OWNER}@example.com"))
        await s.commit()

    rival = {"armed": False, "fired": False}

    def before(conn, cursor, statement, parameters, context, executemany):
        if not rival["armed"] or rival["fired"]:
            return
        if not statement.lstrip().upper().startswith("INSERT INTO TASK_RELATIONS"):
            return
        rival["fired"] = True
        # The other event's transaction recorded the same link and committed
        # while ours was between its lookup and its own insert.
        with sqlite3.connect(db_file) as other:
            other.execute(
                "INSERT INTO task_relations (child_task_id, parent_task_id, user_id) VALUES (?, ?, ?)",
                (CHILD, PARENT, OWNER),
            )

    event.listen(engine.sync_engine, "before_cursor_execute", before)
    try:
        yield factory, rival
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", before)
        await engine.dispose()


def _properties() -> dict:
    return {"taskId": CHILD, "parentTaskId": PARENT, "isSubtask": True}


async def test_a_relation_insert_that_loses_the_race_keeps_the_winners_row(race):
    # record_relation directly: in record_event the event row is written
    # first, and SQLite (unlike Postgres) then locks the rival connection out.
    factory, rival = race
    rival["armed"] = True

    async with factory() as s:
        await record_relation(s, _properties(), user_id=OWNER)
        await s.commit()

    assert rival["fired"], "the hook never saw the relation insert"
    async with factory() as s:
        relations = (await s.execute(select(TaskRelation))).scalars().all()
    assert [(r.child_task_id, r.parent_task_id) for r in relations] == [(CHILD, PARENT)]


async def test_a_relation_without_a_rival_is_recorded_once(race):
    factory, _rival = race

    async with factory() as s:
        await record_event(s, OWNER, None, "Task Created", _properties())
        await record_event(s, OWNER, None, "Task Message", _properties())
        await s.commit()

    async with factory() as s:
        relations = (await s.execute(select(TaskRelation))).scalars().all()
        events = (
            await s.execute(select(func.count(TelemetryEvent.id)).where(TelemetryEvent.task_id == CHILD))
        ).scalar_one()
    assert events == 2
    assert len(relations) == 1
    assert relations[0].user_id == OWNER
    assert relations[0].created_at is not None
