"""The backfill writes its rows with one bulk INSERT, not one ORM object per row (P11).

A backfill replaces a whole conversation (up to BACKFILL_MAX_BYTES, 10 MB).
It used to build one ``TaskMessage`` ORM object per message on the event loop
and let the unit of work flush them. The rows are now plain dicts built in a
worker thread (see test_event_loop_offload) and inserted with one Core
``INSERT`` executed with the whole list.

The stored rows must be exactly what the ORM path stored: the same payloads,
``ts``, quality marks, tool paths and token/cost figures, one row per ``ts``
holding the later message (DEF-C49), and a re-upload still replaces the
previous conversation.
"""

import json

from sqlalchemy import event, select

from src.models.task import Task, TaskMessage
from tests.web_helpers import _backfill_files, _override_current_user, _seed_user

TASK = "task-bulk"


def _conversation():
    return [
        {"ts": 100, "type": "say", "say": "text", "text": "Fix the flaky test"},
        {
            "ts": 110,
            "type": "say",
            "say": "api_req_started",
            "text": json.dumps({"tokensIn": 500, "tokensOut": 40, "cacheReads": 7, "cost": 0.002}),
        },
        {"ts": 120, "type": "ask", "ask": "tool", "text": json.dumps({"tool": "readFile", "path": "a.py"})},
        # Same ts twice: only the later message keeps a row.
        {"ts": 130, "type": "ask", "ask": "command_output", "text": ""},
        {"ts": 130, "type": "say", "say": "command_output", "text": "1 passed"},
        # No ts: appended as it is.
        {"type": "say", "say": "text", "text": "no timestamp"},
        # Not a dict: stored verbatim (a string) or serialized.
        "a bare string",
        {"ts": 140, "type": "say", "say": "completion_result", "text": "Done"},
    ]


def _upload(client, messages, task_id=TASK):
    _override_current_user(client.app)
    files, data = _backfill_files(task_id, messages)
    return client.post("/api/events/backfill", files=files, data=data)


async def _stored(session_factory, task_id=TASK):
    async with session_factory() as s:
        rows = (
            await s.execute(
                select(TaskMessage).where(TaskMessage.task_id == task_id).order_by(TaskMessage.created_at)
            )
        ).scalars().all()
        task = (await s.execute(select(Task).where(Task.id == task_id))).scalar_one()
    return rows, task


def _insert_counter(engine):
    executions = []

    def before(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("INSERT INTO TASK_MESSAGES"):
            executions.append(executemany)

    event.listen(engine.sync_engine, "before_cursor_execute", before)
    return executions, lambda: event.remove(engine.sync_engine, "before_cursor_execute", before)


async def test_a_backfill_creates_no_orm_object_per_message(client, db_session):
    """The per-row cost on the loop was the ORM: one TaskMessage object, its
    identity-map entry and unit-of-work bookkeeping per message."""
    await _seed_user(db_session)
    constructed = []

    def on_init(target, args, kwargs):
        constructed.append(target)

    event.listen(TaskMessage, "init", on_init)
    try:
        resp = _upload(client, _conversation())
    finally:
        event.remove(TaskMessage, "init", on_init)

    assert resp.status_code == 200
    assert constructed == []


async def test_a_backfill_inserts_all_rows_with_one_statement(client, db_session, test_engine):
    await _seed_user(db_session)
    messages = [{"ts": i, "type": "say", "say": "text", "text": f"m{i}"} for i in range(1, 201)]
    executions, stop = _insert_counter(test_engine)
    try:
        resp = _upload(client, messages)
    finally:
        stop()

    assert resp.status_code == 200
    assert len(executions) == 1


async def test_the_stored_rows_are_the_ones_the_orm_path_stored(client, db_session, session_factory):
    await _seed_user(db_session)

    assert _upload(client, _conversation()).status_code == 200

    rows, task = await _stored(session_factory)
    stored = sorted(
        (
            (r.message_ts if r.message_ts is not None else -1),
            r.message_data,
            r.q_kind,
            r.tool_path,
            r.tokens_in,
            r.tokens_out,
            r.cache_reads,
            r.cache_writes,
            r.cost,
        )
        for r in rows
    )
    conversation = _conversation()
    assert stored == sorted(
        [
            (100, json.dumps(conversation[0]), None, None, 0, 0, 0, 0, 0.0),
            (110, json.dumps(conversation[1]), "request", None, 500, 40, 7, 0, 0.002),
            (120, json.dumps(conversation[2]), "tool", "readFile:a.py", 0, 0, 0, 0, 0.0),
            (130, json.dumps(conversation[4]), None, None, 0, 0, 0, 0, 0.0),
            (-1, json.dumps(conversation[5]), None, None, 0, 0, 0, 0, 0.0),
            (-1, "a bare string", None, None, 0, 0, 0, 0, 0.0),
            (140, json.dumps(conversation[7]), "completion", None, 0, 0, 0, 0, 0.0),
        ]
    )
    # Column defaults still apply per row: a distinct id and a creation time.
    assert len({r.id for r in rows}) == len(rows)
    assert all(r.id.startswith("msg_") and r.created_at is not None for r in rows)
    # The summary is re-derived from the whole upload.
    assert task.title == "Fix the flaky test"
    assert task.message_count == len(rows)
    assert task.tokens_in == 500


async def test_a_reupload_still_replaces_the_conversation(client, db_session, session_factory):
    await _seed_user(db_session)
    assert _upload(client, _conversation()).status_code == 200

    shorter = [{"ts": 100, "type": "say", "say": "text", "text": "Start over"}]
    assert _upload(client, shorter).status_code == 200

    rows, task = await _stored(session_factory)
    assert [json.loads(r.message_data)["text"] for r in rows] == ["Start over"]
    assert task.title == "Start over"


async def test_an_empty_upload_stores_no_rows(client, db_session, session_factory):
    await _seed_user(db_session)

    assert _upload(client, []).status_code == 200

    rows, _task = await _stored(session_factory)
    assert rows == []
