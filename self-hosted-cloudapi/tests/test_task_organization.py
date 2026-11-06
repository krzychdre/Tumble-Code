"""A new task row belongs to the organization active in the client.

The bridge handshake token and the extension API token both carry the org
claim of the organization the user switched to (empty for the personal
space). A task row takes it when the row is created, from either write path,
and never moves afterwards.
"""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, select

from src.auth.jwt_issuer import issue_session_token
from src.models.organization import Membership, Organization
from src.models.task import Task
from src.realtime import sio as sio_module
from src.realtime.hub import registry
from src.realtime.sio import EVT_MESSAGE
from tests.web_helpers import _backfill_files, _override_current_user, _seed_user

USER = "user_test"
ORG = "org_acme"


@pytest.fixture(autouse=True)
def _clean_registry():
    registry.reset()
    yield
    registry.reset()


@pytest.fixture
def bridge(monkeypatch, session_factory):
    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    monkeypatch.setattr(sio_module.sio, "emit", AsyncMock())


async def _seed(db_session):
    await _seed_user(db_session, USER)
    db_session.add(Organization(id=ORG, name="Acme"))
    db_session.add(Task(id="task-personal", user_id=USER))
    await db_session.flush()
    db_session.add(Membership(user_id=USER, organization_id=ORG))
    await db_session.commit()


async def _org_of(session_factory, task_id):
    async with session_factory() as s:
        return await s.scalar(select(Task.organization_id).where(Task.id == task_id))


def _message_event(task_id):
    message = {"ts": 1, "type": "say", "say": "text", "text": "hi"}
    return {"taskId": task_id, "type": EVT_MESSAGE, "message": message}


async def test_bridge_task_takes_the_handshake_org(bridge, db_session, session_factory):
    await _seed(db_session)
    token = issue_session_token(USER, ORG, expires_in=300)
    assert await sio_module.connect("ext", {}, {"token": token}) is True
    registry.register_extension("ext", USER)

    await sio_module.on_task_event("ext", _message_event("task-new"))
    await sio_module.on_task_event("ext", _message_event("task-personal"))

    assert await _org_of(session_factory, "task-new") == ORG
    assert await _org_of(session_factory, "task-personal") is None


async def test_backfilled_task_takes_the_token_org(client, db_session, session_factory):
    await _seed(db_session)
    _override_current_user(client.app, USER, ORG)

    for task_id in ("task-up", "task-personal"):
        files, data = _backfill_files(task_id, [_message_event(task_id)["message"]])
        assert (
            client.post("/api/events/backfill", files=files, data=data).status_code
            == 200
        )

    assert await _org_of(session_factory, "task-up") == ORG
    assert await _org_of(session_factory, "task-personal") is None


async def test_a_removed_member_files_new_tasks_into_the_personal_space(
    bridge, db_session, session_factory
):
    """The handshake token keeps its org claim for the socket's lifetime; a
    user taken out of the organization since must not add tasks to it."""
    await _seed(db_session)
    token = issue_session_token(USER, ORG, expires_in=300)
    assert await sio_module.connect("ext", {}, {"token": token}) is True
    registry.register_extension("ext", USER)
    await db_session.execute(delete(Membership))
    await db_session.commit()

    await sio_module.on_task_event("ext", _message_event("task-after-removal"))

    assert await _org_of(session_factory, "task-after-removal") is None
