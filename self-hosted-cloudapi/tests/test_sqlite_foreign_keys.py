"""The test database enforces foreign keys the way Postgres does.

Production runs on Postgres, which rejects a child row whose parent does not
exist and applies every ``ON DELETE`` rule. The suite runs on SQLite only (owner
decision 23: no Postgres in CI), and SQLite ignores FOREIGN KEY clauses unless
each connection switches them on. Without that, a write Postgres refuses passes
every test here and fails only in production (DEF-C47 was exactly that).

These tests pin that the shared ``test_engine`` fixture (tests/conftest.py)
switches enforcement on for every session, including the ones the app opens
through the overridden ``get_db``.
"""

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from src.models.task import Task, TaskMessage
from src.models.user import User


async def _foreign_keys_enabled(session) -> int:
    return (await session.execute(text("PRAGMA foreign_keys"))).scalar()


async def test_every_session_enforces_foreign_keys(session_factory, db_session):
    assert await _foreign_keys_enabled(db_session) == 1
    async with session_factory() as other:
        assert await _foreign_keys_enabled(other) == 1


async def test_a_child_row_without_its_parent_is_rejected(db_session):
    db_session.add(Task(id="orphan", user_id="no_such_user"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_on_delete_rules_apply_like_postgres(db_session):
    """``ON DELETE SET NULL`` on ``tasks.parent_task_id`` and ``ON DELETE CASCADE``
    on ``task_messages.task_id`` both fire when the parent row goes away."""
    db_session.add(
        User(id="u1", authentik_id="ak_u1", email="u1@example.com",
             first_name="U", last_name="One")
    )
    # One flush per level: no ORM relationship orders these inserts.
    await db_session.flush()
    db_session.add(Task(id="parent", user_id="u1"))
    await db_session.flush()
    db_session.add(Task(id="child", user_id="u1", parent_task_id="parent"))
    db_session.add(TaskMessage(task_id="parent", message_data="{}"))
    await db_session.commit()

    # Plain SQL on purpose: the database, not the ORM, must apply the rules.
    await db_session.execute(text("DELETE FROM tasks WHERE id = 'parent'"))
    await db_session.commit()
    db_session.expire_all()

    child = (await db_session.execute(select(Task).where(Task.id == "child"))).scalar_one()
    assert child.parent_task_id is None
    remaining = (await db_session.execute(select(TaskMessage))).scalars().all()
    assert remaining == []
