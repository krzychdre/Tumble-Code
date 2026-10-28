"""The live bridge and the subtask tree (CAPI-M11).

A subtask's link to its parent reaches the server by three independent routes
that arrive in no fixed order:

  * the parent's streamed chunks (they create the parent's task row),
  * the child's streamed chunks (they create the child's task row),
  * a telemetry event naming ``parentTaskId`` (it records the relation).

``task_tree`` makes the link survive any ordering: ``record_relation`` stamps a
child row that already exists, and a freshly created row adopts its parent and
claims its waiting children. The permutation tests below pin that the final
linkage is the same for every ordering; the counting tests pin that a chunk for
a task that already exists runs no tree-link queries at all, because nothing a
chunk carries can change the link.

``tasks.parent_task_id`` is a foreign key to ``tasks.id``. Postgres enforces it,
SQLite does not unless the connection asks for it; the shared ``test_engine``
fixture (tests/conftest.py) switches ``PRAGMA foreign_keys=ON`` on for every
connection. Without it an ordering that writes a parent id before the parent
row exists passes here and fails in production (DEF-C47).
"""

import asyncio
import itertools
import json
import math
import random
from datetime import datetime

import pytest
from sqlalchemy import event, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.relation import TaskRelation
from src.models.task import Task
from src.models.user import User
from src.realtime import sio as sio_module
from src.realtime.hub import registry
from src.realtime.sio import EVT_MESSAGE
from src.services import telemetry_service
from src.services.share_service import delete_tasks
from src.services.task_tree import (
    RUN_DEPTH_MAX,
    ancestors,
    record_relation,
    refresh_run_totals,
)
from src.services.telemetry_service import record_event, upsert_task_message

USER = "owner"
PARENT = "task-parent"
CHILD = "task-child"


@pytest.fixture(autouse=True)
def _clean_registry():
    registry.reset()
    yield
    registry.reset()


@pytest.fixture
async def bridge(monkeypatch, session_factory, db_session):
    """A signed-in user with one attached extension socket, relays stubbed."""

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    monkeypatch.setattr(sio_module.sio, "emit", _noop)
    db_session.add(
        User(
            id=USER,
            authentik_id=f"ak_{USER}",
            email="o@example.com",
            first_name="O",
            last_name="Wner",
        )
    )
    await db_session.commit()
    registry.attach("ext_owner", "extension", USER)
    registry.register_extension("ext_owner", USER)
    return session_factory


@pytest.fixture
def link_calls(monkeypatch):
    """Count the calls to the tree-link step, per task id."""
    calls: list[str] = []
    original = telemetry_service._link_task_tree

    async def counting(db, task_id):
        calls.append(task_id)
        await original(db, task_id)

    monkeypatch.setattr(telemetry_service, "_link_task_tree", counting)
    return calls


@pytest.fixture
def relation_queries(test_engine):
    """Count the SQL statements that read or write the task relations."""
    statements: list[str] = []

    def before(conn, cursor, statement, parameters, context, executemany):
        if "task_relations" in statement:
            statements.append(statement)

    event.listen(test_engine.sync_engine, "before_cursor_execute", before)
    yield statements
    event.remove(test_engine.sync_engine, "before_cursor_execute", before)


async def _stream(task_id: str, first_ts: int, count: int = 3) -> None:
    """Stream ``count`` messages for a task: partial revisions, then a final."""
    for i in range(count):
        partial = i < count - 1
        await sio_module.on_task_event(
            "ext_owner",
            {
                "taskId": task_id,
                "type": EVT_MESSAGE,
                "message": {
                    "ts": first_ts,
                    "type": "say",
                    "say": "reasoning",
                    "text": "thinking " * (i + 1),
                    **({"partial": True} if partial else {}),
                },
            },
        )


async def _relation(session_factory, child: str, parent: str) -> None:
    """The telemetry event through which a subtask names its parent."""
    async with session_factory() as db:
        await record_event(
            db,
            USER,
            None,
            "Task Created",
            {"taskId": child, "parentTaskId": parent, "isSubtask": True},
        )
        await db.commit()


async def _parent_of(session_factory, task_id: str):
    async with session_factory() as db:
        return (
            await db.execute(select(Task.parent_task_id).where(Task.id == task_id))
        ).scalar_one()


async def test_the_test_database_enforces_the_parent_foreign_key(bridge):
    """Guard for the fixture above: a parent id that names no row is refused,
    as Postgres refuses it. If this passes vacuously, the ordering tests below
    cannot catch a write that only Postgres would reject."""
    async with bridge() as db:
        db.add(Task(id=CHILD, user_id=USER, parent_task_id="no-such-task"))
        with pytest.raises(IntegrityError):
            await db.flush()


async def test_a_relation_for_a_stored_child_whose_parent_is_not_stored_yet_is_kept(
    bridge,
):
    """DEF-C47: the child streams (its row exists), then its relation event
    arrives while the parent has no row yet. Stamping the child's
    ``parent_task_id`` then would violate the foreign key and roll back the
    whole telemetry request, losing the event and the relation with it. The
    event and the relation must be stored, the child left unstamped for now,
    and the parent's first chunk must claim it."""
    await _stream(CHILD, 200)
    await _relation(bridge, CHILD, PARENT)

    async with bridge() as db:
        relation = (
            await db.execute(
                select(TaskRelation.parent_task_id).where(
                    TaskRelation.child_task_id == CHILD
                )
            )
        ).scalar_one_or_none()
        events = (
            await db.execute(
                text("SELECT count(*) FROM telemetry_events WHERE task_id = :t"),
                {"t": CHILD},
            )
        ).scalar_one()
    assert relation == PARENT
    assert events == 1
    assert await _parent_of(bridge, CHILD) is None

    await _stream(PARENT, 100)

    assert await _parent_of(bridge, CHILD) == PARENT


STEPS = ("parent_streams", "child_streams", "relation")


@pytest.mark.parametrize(
    "order", list(itertools.permutations(STEPS)), ids="-then-".join
)
async def test_the_child_ends_up_under_its_parent_in_every_arrival_order(bridge, order):
    for step in order:
        if step == "parent_streams":
            await _stream(PARENT, 100)
        elif step == "child_streams":
            await _stream(CHILD, 200)
        else:
            await _relation(bridge, CHILD, PARENT)
    # Both keep streaming afterwards; nothing may undo or move the link.
    await _stream(CHILD, 201)
    await _stream(PARENT, 101)

    assert await _parent_of(bridge, CHILD) == PARENT
    assert await _parent_of(bridge, PARENT) is None


async def test_a_grandchild_streamed_before_its_ancestors_reaches_the_root(bridge):
    """Three levels, worst order: the deepest task streams first, the
    relations arrive next, and the root's row is created last."""
    await _stream("task-grandchild", 300)
    await _relation(bridge, "task-grandchild", CHILD)
    await _relation(bridge, CHILD, PARENT)
    await _stream(CHILD, 200)
    await _stream("task-grandchild", 301)
    await _stream(PARENT, 100)

    async with bridge() as db:
        grandchild = (
            await db.execute(select(Task).where(Task.id == "task-grandchild"))
        ).scalar_one()
        chain = [t.id for t in await ancestors(db, grandchild)]
    assert chain == [CHILD, PARENT]


async def test_a_link_missed_by_a_concurrent_write_is_healed_by_the_next_event(bridge):
    """The child's row and its relation were written by two concurrent
    transactions, so each missed the other: the relation is stored and both
    rows exist, yet the child is unstamped. The subtask's later telemetry events
    (every event of a subtask carries ``parentTaskId``) stamp it; streamed
    chunks are not needed for that."""
    await _stream(PARENT, 100)
    await _stream(CHILD, 200)
    async with bridge() as db:
        db.add(TaskRelation(child_task_id=CHILD, parent_task_id=PARENT, user_id=USER))
        await db.commit()
    assert await _parent_of(bridge, CHILD) is None

    await _relation(bridge, CHILD, PARENT)

    assert await _parent_of(bridge, CHILD) == PARENT


async def test_chunks_for_an_existing_task_run_no_tree_link_queries(
    bridge, link_calls, relation_queries
):
    """The hot path: a streaming reasoning trace upserts many revisions per
    second. The first chunk creates the row and wires it into the tree once;
    later chunks carry nothing that can change the link, so they must not pay
    for it."""
    await _stream(CHILD, 200, count=1)
    assert link_calls == [CHILD]
    created = len(relation_queries)
    assert created == 2  # adopt + claim children, both find nothing

    link_calls.clear()
    relation_queries.clear()
    await _stream(CHILD, 201, count=10)
    await _stream(CHILD, 202, count=10)

    assert link_calls == []
    assert relation_queries == []


async def test_the_first_chunk_of_a_new_task_still_links_it(bridge, link_calls):
    """The row creation is the one moment the bridge can adopt a parent that
    is already known, or claim children that were stored first."""
    await _relation(bridge, CHILD, PARENT)
    await _stream(PARENT, 100, count=1)
    await _stream(CHILD, 200, count=1)

    assert link_calls == [PARENT, CHILD]
    assert await _parent_of(bridge, CHILD) == PARENT


# --- run totals ---------------------------------------------------------------

OTHER = "someone-else"


def _request(ts: int, scale: int, partial: bool = False) -> dict:
    """An API request message; ``scale`` sets its figures."""
    figures = {
        "tokensIn": 100 * scale,
        "tokensOut": 10 * scale,
        "cost": 0.25 * scale,
        "durationMs": 1000 * scale,
    }
    return {
        "ts": ts,
        "type": "say",
        "say": "api_req_started",
        "text": json.dumps(figures),
        **({"partial": True} if partial else {}),
    }


async def _seed_users(db) -> None:
    for user in (USER, OTHER):
        db.add(User(id=user, authentik_id=f"ak_{user}", email=f"{user}@example.com"))
    await db.flush()


async def _owner(db, task_id: str):
    return await db.scalar(select(Task.user_id).where(Task.id == task_id))


async def _assert_runs_are_summed(db) -> None:
    """Every task holds the sums of its run, walked here: the task and every
    task beneath it of the same owner, each once."""
    rows = (
        await db.execute(
            select(
                Task.id,
                Task.parent_task_id,
                Task.user_id,
                Task.cost,
                Task.tokens_in,
                Task.tokens_out,
                Task.duration_ms,
                Task.run_cost,
                Task.run_tokens,
                Task.run_duration_ms,
            )
        )
    ).all()
    children: dict = {}
    for row in rows:
        children.setdefault(row.parent_task_id, []).append(row)
    for run in rows:
        members, stack = {run.id: run}, [run]
        while stack:
            for child in children.get(stack.pop().id, []):
                if child.user_id == run.user_id and child.id not in members:
                    members[child.id] = child
                    stack.append(child)
        assert (run.run_cost, run.run_tokens, run.run_duration_ms) == (
            pytest.approx(sum(m.cost for m in members.values())),
            sum(m.tokens_in + m.tokens_out for m in members.values()),
            sum(m.duration_ms for m in members.values()),
        ), run.id


async def test_run_totals_follow_every_write_that_changes_a_run(db_session):
    """Recomputed, never adjusted: after any sequence of the writes that move
    a run (a task's figures up or down, a parent link from either side, a
    row created by a streamed partial, which refreshes no summary, a delete
    with or without its subtasks) every task holds its run's sums.

    The opening builds the cases that matter for certain: a chain, a subtask
    of another owner with the first owner's task beneath it, and a cycle. The
    seeded random walk then mixes the writes."""
    db = db_session
    await _seed_users(db)
    for task, user in (("a", USER), ("b", USER), ("c", USER), ("d", OTHER)):
        await upsert_task_message(db, task, user, None, _request(1, 1))
    await upsert_task_message(db, "e", USER, None, _request(1, 4))
    for child, parent in (("b", "a"), ("c", "b"), ("d", "c"), ("e", "d"), ("a", "c")):
        await record_relation(db, {"taskId": child, "parentTaskId": parent})
    await _assert_runs_are_summed(db)

    rng = random.Random(20261028)
    tasks = ["a", "b", "c", "d", "e", *(f"t{n}" for n in range(8))]
    for _ in range(200):
        task = rng.choice(tasks)
        action = rng.choice(("message", "message", "link", "delete"))
        if action == "message":
            # Three timestamps per task: a later final revision of a request
            # rewrites its figures.
            user = await _owner(db, task) or rng.choice((USER, OTHER))
            partial = rng.random() < 0.3
            message = _request(rng.randrange(3), rng.randrange(6), partial)
            await upsert_task_message(db, task, user, None, message)
        elif action == "link":
            parent = rng.choice(tasks)
            await record_relation(db, {"taskId": task, "parentTaskId": parent})
        elif user := await _owner(db, task):
            await delete_tasks(db, [task], user, include_subtasks=rng.random() < 0.5)
        await _assert_runs_are_summed(db)


async def test_a_subtask_adds_to_its_runs_totals_but_not_its_last_activity(
    db_session,
):
    """The list orders runs by their own last activity; a subtask's work moves
    its run's totals without moving the run up the list."""
    db = db_session
    await _seed_users(db)
    then = datetime(2026, 1, 1, 12, 0)
    db.add(Task(id=PARENT, user_id=USER, updated_at=then))
    await db.flush()
    await upsert_task_message(db, CHILD, USER, None, _request(1, 2))
    await record_relation(db, {"taskId": CHILD, "parentTaskId": PARENT})
    await upsert_task_message(db, CHILD, USER, None, _request(2, 2))

    run_cost, updated = (
        await db.execute(
            select(Task.run_cost, Task.updated_at).where(Task.id == PARENT)
        )
    ).one()
    assert run_cost == pytest.approx(1.0)
    assert updated == then


async def test_a_run_reaches_at_most_its_depth_bound(db_session):
    """A client can link a chain of any depth or close a cycle; a write climbs
    at most RUN_DEPTH_MAX levels and a run walks at most that many down, so it
    costs a bounded walk. Real trees are far shallower and keep exact totals."""
    db = db_session
    await _seed_users(db)
    chain = [f"deep{n:03}" for n in range(RUN_DEPTH_MAX + 2)]
    for task, parent in zip(chain, [None, *chain]):
        db.add(Task(id=task, user_id=USER, parent_task_id=parent, cost=1.0))
        await db.flush()

    async def run_cost(task: str) -> float:
        return await db.scalar(select(Task.run_cost).where(Task.id == task))

    await refresh_run_totals(db, [chain[-1]])
    assert await run_cost(chain[1]) == RUN_DEPTH_MAX + 1
    assert await run_cost(chain[0]) == 0, "beyond the climb"

    await refresh_run_totals(db, [chain[0]])
    assert await run_cost(chain[0]) == RUN_DEPTH_MAX + 1, "the bottom is out of reach"


@pytest.mark.parametrize("child, parent", [("t" * 257, PARENT), (CHILD, 5)])
async def test_a_link_naming_no_task_id_links_nothing(db_session, child, parent):
    """A task id is a string of at most TASK_ID_MAX characters: a longer
    parent id would not fit ix_tasks_parent_user beside its owner, and a
    number is no id."""
    db = db_session
    await _seed_users(db)
    for task in (child, PARENT):
        db.add(Task(id=task, user_id=USER))
    await db.flush()

    await record_relation(db, {"taskId": child, "parentTaskId": parent})

    assert await db.scalar(select(func.count()).select_from(TaskRelation)) == 0
    assert await db.scalar(select(Task.parent_task_id).where(Task.id == child)) is None


def _capture_run_writes(test_engine) -> list[list[str]]:
    """The task ids of each UPDATE of run totals, in the order they are written."""
    written: list[list[str]] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE tasks SET") and "run_cost" in statement:
            # The task id is the WHERE clause's parameter, the last one.
            written.append([row[-1] for row in parameters])

    event.listen(test_engine.sync_engine, "before_cursor_execute", capture)
    return written


async def test_unchanged_run_totals_are_not_written(db_session, test_engine):
    """Postgres adds a run's costs in the order its plan reads them, so a
    second sum can differ from the stored one in the last bit. That is not a
    change: rewriting the row would lock it for nothing."""
    db = db_session
    await _seed_users(db)
    db.add(Task(id=PARENT, user_id=USER, cost=0.1, run_cost=math.nextafter(0.1, 1)))
    await db.flush()

    written = _capture_run_writes(test_engine)
    await refresh_run_totals(db, [PARENT])

    assert written == []


async def _until_a_writer_waits(db) -> None:
    """Return once a session of this database waits for a row lock."""
    for _ in range(200):
        waiting = await db.scalar(
            text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
        )
        if waiting:
            return
        await asyncio.sleep(0.025)
    raise AssertionError("no writer waited for a lock")


async def test_a_subtask_and_its_parent_writing_at_once_both_reach_the_totals(
    pg_session,
):
    """Postgres: the parent has written its own figures, uncommitted, when its
    subtask records a request; then the parent climbs. The subtask waits for
    the parent's row and sums the run again once the parent commits: summed
    before the wait, it would write totals without the parent's figures.
    Taking the rows from the root down, the two would deadlock."""
    db = pg_session
    await _seed_users(db)
    # Ids sort from the root down, as uuid7 ids do.
    for task, parent in (
        ("a-root", None),
        ("b-parent", "a-root"),
        ("c-sub", "b-parent"),
    ):
        db.add(Task(id=task, user_id=USER, parent_task_id=parent))
        await db.flush()
    await db.commit()

    async with AsyncSession(db.bind) as parent, AsyncSession(db.bind) as sub:
        # What refresh_task_summary does, its two steps apart.
        await parent.execute(
            update(Task)
            .where(Task.id == "b-parent")
            .values(cost=1.0, tokens_in=100, duration_ms=1000)
        )
        waiting = asyncio.create_task(
            upsert_task_message(sub, "c-sub", USER, None, _request(1, 1))
        )
        await _until_a_writer_waits(db)
        await refresh_run_totals(parent, ["b-parent"])
        await parent.commit()
        await waiting
        await sub.commit()

    await _assert_runs_are_summed(db)


async def test_a_write_never_locks_another_owners_run_above_it(pg_session):
    """Postgres: a task linked under another user's run (a link a client can
    send) moves only its owner's totals, so its write climbs no further than
    its owner's tasks: the other user writes their run while it is open."""
    db = pg_session
    await _seed_users(db)
    db.add(Task(id="b-run", user_id=OTHER))
    await db.flush()
    db.add(Task(id="a-task", user_id=USER, parent_task_id="b-run"))
    await db.commit()

    async with AsyncSession(db.bind) as a, AsyncSession(db.bind) as b:
        await upsert_task_message(a, "a-task", USER, None, _request(1, 1))
        await b.execute(text("SET LOCAL lock_timeout = '2s'"))
        await upsert_task_message(b, "b-run", OTHER, None, _request(1, 2))
        await b.commit()
        await a.commit()

    await _assert_runs_are_summed(db)


@pytest.mark.parametrize(
    "deleted, writer, remaining",
    [
        (["a-root", "c-sub"], "c-sub", [("b-mid", None)]),
        (["a-root"], "b-mid", [("b-mid", None), ("c-sub", "b-mid")]),
    ],
    ids=["run-and-subtask", "run-whose-child-streams"],
)
async def test_a_delete_and_a_streaming_subtask_wait_for_each_other_without_deadlock(
    pg_session, deleted, writer, remaining
):
    """Postgres: a delete while a subtask below it records a request (a bulk
    delete of the run and the subtask two levels down; the run alone while its
    child streams). The delete locks deepest first, as the subtask's climb
    does, so it waits for the subtask's row before it holds a row above it.
    Taking the rows in the order its statements reach them, it held a row
    above (the middle task, its link cut; the run, deleted) that the
    subtask's climb then waited for: a deadlock."""
    db = pg_session
    await _seed_users(db)
    for task, parent in (("a-root", None), ("b-mid", "a-root"), ("c-sub", "b-mid")):
        db.add(Task(id=task, user_id=USER, parent_task_id=parent))
        await db.flush()
    await db.commit()

    async with AsyncSession(db.bind) as sub, AsyncSession(db.bind) as deleter:
        # What refresh_task_summary does, its two steps apart.
        await sub.execute(
            update(Task)
            .where(Task.id == writer)
            .values(cost=1.0, tokens_in=100, duration_ms=1000)
        )
        deleting = asyncio.create_task(delete_tasks(deleter, deleted, USER))
        await _until_a_writer_waits(db)
        await refresh_run_totals(sub, [writer])
        await sub.commit()
        assert await deleting == len(deleted)
        await deleter.commit()

    rows = await db.execute(select(Task.id, Task.parent_task_id).order_by(Task.id))
    assert rows.all() == remaining
    await _assert_runs_are_summed(db)
