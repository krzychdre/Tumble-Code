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

import itertools

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import IntegrityError

from src.models.relation import TaskRelation
from src.models.task import Task
from src.models.user import User
from src.realtime import sio as sio_module
from src.realtime.hub import registry
from src.realtime.sio import EVT_MESSAGE
from src.services import telemetry_service
from src.services.task_tree import ancestors
from src.services.telemetry_service import record_event

USER = "owner"
PARENT = "task-parent"
CHILD = "task-child"


@pytest.fixture(autouse=True)
def _clean_registry():
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
async def bridge(monkeypatch, session_factory, db_session):
    """A signed-in user with one attached extension socket, relays stubbed."""

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    monkeypatch.setattr(sio_module.sio, "emit", _noop)
    db_session.add(
        User(id=USER, authentik_id=f"ak_{USER}", email="o@example.com",
             first_name="O", last_name="Wner")
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
            db, USER, None, "Task Created",
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


async def test_a_relation_for_a_stored_child_whose_parent_is_not_stored_yet_is_kept(bridge):
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
                select(TaskRelation.parent_task_id).where(TaskRelation.child_task_id == CHILD)
            )
        ).scalar_one_or_none()
        events = (
            await db.execute(text("SELECT count(*) FROM telemetry_events WHERE task_id = :t"), {"t": CHILD})
        ).scalar_one()
    assert relation == PARENT
    assert events == 1
    assert await _parent_of(bridge, CHILD) is None

    await _stream(PARENT, 100)

    assert await _parent_of(bridge, CHILD) == PARENT


STEPS = ("parent_streams", "child_streams", "relation")


@pytest.mark.parametrize("order", list(itertools.permutations(STEPS)), ids="-then-".join)
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
