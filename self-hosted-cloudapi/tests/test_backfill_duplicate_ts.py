"""A shared conversation with two messages under one ``ts`` (DEF-C49).

The extension often stamps two consecutive messages with the same ``ts``: in
the owner's corpus 653 of 1,212 tasks have at least one such pair, almost
always an ``ask: command_output`` followed by a ``say: command_output``, also
``ask: tool`` + ``say: checkpoint_saved`` and ``say: reasoning`` +
``say: text``. The backfill inserted one row per message, so the unique
``(task_id, message_ts)`` index rejected the upload and sharing the task failed
with a 500.

Owner decision 26: store it the way the live bridge does, one row per ``ts``
holding the LATER message of the pair. Messages without a ``ts`` still append.

Quality classification walks the FULL conversation, in the order it happened,
and each stored row keeps the mark of the message it holds. The sequence state
(is an ``attempt_completion`` awaiting an answer?) is a fact about the run, and
a message that lost its row still happened: a tool call after a completion
means the next ``user_feedback`` is a mid-run correction, not a reply to the
result. The counts are a rollup over the stored rows, so, as on the live
bridge, the losing message's own marker is not counted: one row per ``ts``
can carry only one.
"""

import json

from sqlalchemy import select

from src.dependencies import get_current_user
from src.models.task import Task, TaskMessage
from src.models.user import User

USER = "user_test"


async def _seed_user(db_session):
    db_session.add(User(id=USER, authentik_id=f"ak_{USER}", email="t@example.com"))
    await db_session.commit()


def _upload(client, task_id, messages):
    client.app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "org_id": None}
    try:
        return client.post(
            "/api/events/backfill",
            files={"file": ("task.json", json.dumps(messages), "application/json")},
            data={"taskId": task_id, "properties": "{}"},
        )
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)


async def _rows(session_factory, task_id):
    async with session_factory() as s:
        rows = await s.execute(
            select(TaskMessage.message_ts, TaskMessage.message_data, TaskMessage.q_kind)
            .where(TaskMessage.task_id == task_id)
            .order_by(TaskMessage.message_ts)
        )
        return [(ts, json.loads(data), kind) for ts, data, kind in rows.all()]


def _command_run():
    """A run that executes one command, as the extension stores it."""
    return [
        {"ts": 100, "type": "say", "say": "text", "text": "Run the test suite"},
        {
            "ts": 110,
            "type": "say",
            "say": "api_req_started",
            "text": json.dumps({"tokensIn": 500, "tokensOut": 40, "cost": 0.002}),
        },
        {"ts": 120, "type": "ask", "ask": "command", "text": "pytest -q"},
        # The same ts twice: the approval prompt for the running command's
        # output, then the output itself.
        {"ts": 130, "type": "ask", "ask": "command_output", "text": ""},
        {"ts": 130, "type": "say", "say": "command_output", "text": "3 passed in 0.1s"},
        {"ts": 140, "type": "say", "say": "completion_result", "text": "All tests pass"},
    ]


async def test_an_upload_with_a_shared_ts_keeps_the_later_message(
    client, db_session, session_factory
):
    await _seed_user(db_session)

    resp = _upload(client, "task-dup", _command_run())

    assert resp.status_code == 200
    rows = await _rows(session_factory, "task-dup")
    assert [ts for ts, _msg, _kind in rows] == [100, 110, 120, 130, 140]
    assert rows[3][1] == {"ts": 130, "type": "say", "say": "command_output", "text": "3 passed in 0.1s"}

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-dup"))).scalar_one()
    assert task.title == "Run the test suite"
    assert task.message_count == 5
    assert task.tokens_in == 500
    assert task.tokens_out == 40
    assert task.first_ts == 100
    assert task.last_ts == 140
    assert task.q_requests == 1
    assert task.q_tools == 1
    assert task.q_completed is True


async def test_resharing_a_shared_ts_conversation_replaces_it(client, db_session, session_factory):
    await _seed_user(db_session)

    assert _upload(client, "task-dup", _command_run()[:5]).status_code == 200
    assert _upload(client, "task-dup", _command_run()).status_code == 200

    assert len(await _rows(session_factory, "task-dup")) == 5


async def test_classification_follows_the_full_conversation(client, db_session, session_factory):
    """The feedback comes after a tool call that ran after the completion, so it
    is a mid-run correction. The tool call's row went to the checkpoint that
    shares its ts; classifying only the stored rows would miss that the run
    moved on and call the feedback a reply to the result."""
    await _seed_user(db_session)
    messages = [
        {"ts": 10, "type": "say", "say": "text", "text": "Fix the bug"},
        {"ts": 20, "type": "say", "say": "completion_result", "text": "Fixed"},
        {
            "ts": 30,
            "type": "ask",
            "ask": "tool",
            "text": json.dumps({"tool": "editedExistingFile", "path": "src/a.py"}),
        },
        {"ts": 30, "type": "say", "say": "checkpoint_saved", "text": "abc123"},
        {"ts": 40, "type": "say", "say": "user_feedback", "text": "Also cover b.py"},
    ]

    assert _upload(client, "task-seq", messages).status_code == 200

    rows = await _rows(session_factory, "task-seq")
    assert [(ts, msg.get("say") or msg.get("ask"), kind) for ts, msg, kind in rows] == [
        (10, "text", None),
        (20, "completion_result", "completion"),
        (30, "checkpoint_saved", None),
        (40, "user_feedback", "intervention"),
    ]
    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-seq"))).scalar_one()
    assert task.message_count == 4
    assert task.q_interventions == 1
    assert task.q_completion_replies == 0
    # One row per ts: the tool call's own marker went with its row.
    assert task.q_tools == 0


async def test_messages_without_a_ts_still_append(client, db_session, session_factory):
    await _seed_user(db_session)
    messages = [
        {"type": "say", "say": "text", "text": "Legacy message"},
        {"type": "say", "say": "text", "text": "Another legacy message"},
        {"ts": 5, "type": "say", "say": "text", "text": "Stamped"},
    ]

    assert _upload(client, "task-legacy", messages).status_code == 200

    rows = await _rows(session_factory, "task-legacy")
    assert sorted(msg["text"] for _ts, msg, _kind in rows) == [
        "Another legacy message",
        "Legacy message",
        "Stamped",
    ]
