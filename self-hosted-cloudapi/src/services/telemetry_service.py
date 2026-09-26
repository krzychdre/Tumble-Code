"""Telemetry event recording service."""

import json
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.event import TelemetryEvent
from src.services.telemetry_vocab import LLM_COMPLETION_EVENT


async def _live_quality_kind(db, task_id: str, message: dict, ts) -> str | None:
    """Quality marker for a message arriving one at a time over the bridge.

    All but one of the markers depend on the message alone. The exception is a
    ``user_feedback``: it is an ordinary mid-run correction, unless an
    ``attempt_completion`` was awaiting an answer, in which case it means the
    result was turned down — the strongest quality signal there is.

    A backfill sees the whole conversation and simply walks it; here there is
    only this message, so the state has to come from what is already stored.
    That costs one indexed lookup, and only for ``user_feedback`` messages,
    which are rare (278 in a 53 000-message corpus).
    """
    from sqlalchemy import desc, select
    from src.models.task import TaskMessage
    from src.services.session_quality import (
        KIND_COMPLETION,
        KIND_INTERVENTION,
        KIND_COMPLETION_REPLY,
        KIND_REQUEST,
        KIND_TOOL,
        classify_message,
    )

    kind = classify_message(message, awaiting_completion=False)
    if kind != KIND_INTERVENTION or ts is None:
        return kind

    # The most recent marker before this message that either sets or clears the
    # "a completion is awaiting an answer" state.
    result = await db.execute(
        select(TaskMessage.q_kind)
        .where(
            TaskMessage.task_id == task_id,
            TaskMessage.message_ts.is_not(None),
            TaskMessage.message_ts < ts,
            TaskMessage.q_kind.in_([KIND_COMPLETION, KIND_REQUEST, KIND_TOOL]),
        )
        .order_by(desc(TaskMessage.message_ts))
        .limit(1)
    )
    return KIND_COMPLETION_REPLY if result.scalar_one_or_none() == KIND_COMPLETION else KIND_INTERVENTION


async def _link_task_tree(db, task_id: str) -> None:
    """Wire a task into the subtask tree, in both directions.

    A task can arrive either before or after its relatives: the parent may
    already be stored (so this task is adopted), and children of this task may
    have been stored earlier while it did not exist yet (so they are claimed
    now). Doing both here means no ordering of shares, backfills and live
    streams can leave the tree half-built.
    """
    from src.services.task_tree import adopt_from_relations, link_pending_children

    await adopt_from_relations(db, task_id)
    await link_pending_children(db, task_id)


async def _get_or_create_task(db, task_id: str, user_id: str):
    """Return ``(task, created)``, creating the row for ``user_id`` when missing.

    ``created`` is True only when this call inserted the row. The owner is not
    checked here: a row that already existed (or that a concurrent writer
    inserted first) comes back as it is, and the caller compares its
    ``user_id``.

    The live bridge persists each chunk in its own transaction, so the first
    chunks of a new task run concurrently. A plain lookup-then-insert let two of
    them both miss the lookup and both insert; the loser died on the primary key
    (``tasks_pkey``) and its message was lost (DEF-C48). The insert is therefore
    a dialect-native ``INSERT ... ON CONFLICT (id) DO NOTHING``, and the row is
    read back afterwards, whoever inserted it. On Postgres the losing insert
    waits for the winner's transaction and then does nothing, so the read-back
    sees the committed row.

    The lookup comes first so a chunk for a task that already exists, the
    common case, costs one SELECT as before.
    """
    from sqlalchemy import select
    from src.models.task import Task

    query = select(Task).where(Task.id == task_id)
    task = (await db.execute(query)).scalar_one_or_none()
    if task is not None:
        return task, False

    dialect = db.bind.dialect.name
    if dialect not in ("postgresql", "sqlite"):
        # No portable ON CONFLICT: keep the plain insert.
        task = Task(id=task_id, user_id=user_id)
        db.add(task)
        await db.flush()
        return task, True

    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _insert
    else:
        from sqlalchemy.dialects.sqlite import insert as _insert

    result = await db.execute(
        _insert(Task)
        .values(id=task_id, user_id=user_id)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    created = result.rowcount == 1
    task = (await db.execute(query)).scalar_one()
    return task, created


def _stamp_workspace_path(task, workspace_path) -> None:
    """Record the task's project/worktree root, once.

    Set only when we have a value and the task does not already carry one. A task
    never moves workspaces, so a stored path is authoritative and is never
    overwritten; a NULL on a pre-existing (legacy) row is filled in the first time
    a value becomes known. Empty/whitespace paths are ignored.
    """
    if not (workspace_path and workspace_path.strip()):
        return
    if getattr(task, "workspace_path", None):
        return
    task.workspace_path = workspace_path


async def record_event(
    db: AsyncSession,
    user_id: str,
    org_id: str,
    event_type: str,
    properties: dict,
) -> None:
    """Record a telemetry event."""
    task_id = properties.get("taskId") if isinstance(properties, dict) else None
    event = TelemetryEvent(
        user_id=user_id,
        organization_id=org_id,
        event_type=event_type,
        # Lifted out of the blob at write time: every reader that asks "what
        # happened in this task" then does an indexed lookup instead of parsing
        # JSON across the whole event corpus.
        task_id=task_id if isinstance(task_id, str) and task_id else None,
        properties=json.dumps(properties),
    )
    db.add(event)
    await db.flush()

    # Telemetry is the only place a subtask states which task spawned it, and
    # it says so long before the subtask exists as a row. Capture the link here
    # so the web view can render the tree. See services/task_tree.
    from src.services.task_tree import record_relation

    await record_relation(db, properties, user_id=user_id)

    # …and the only place that says which model answered: a stored
    # `api_req_started` carries tokens and cost but no model. See
    # services/model_attribution.
    if event_type == LLM_COMPLETION_EVENT and event.task_id:
        from src.services.model_attribution import note_completion_model

        model = properties.get("modelId")
        if isinstance(model, str) and model:
            await note_completion_model(db, event.task_id, model)


class TaskNotOwnedError(Exception):
    """The task exists but belongs to another user.

    Raised instead of writing, so a caller cannot forget the check: the
    routers answer it with the same 404 the share endpoint gives, which says
    nothing about whether the task exists.
    """


async def backfill_messages(
    db: AsyncSession,
    task_id: str,
    user_id: str,
    messages: list,
    workspace_path: str | None = None,
) -> None:
    """Backfill task messages.

    Ensures the parent Task row exists (owned by the uploading user) before
    inserting messages — TaskMessage.task_id is a FK to tasks.id, so without
    this the insert raises an IntegrityError. Idempotent: re-uploading a task
    (e.g. re-sharing after more turns) replaces the previously stored messages
    rather than appending duplicates.

    `workspace_path` is the project/worktree root (explicit client field, with a
    registry fallback resolved by the caller); stamped on the Task so offline
    tasks show their project in the web view.

    Raises TaskNotOwnedError, before touching anything, when the task already
    belongs to another user: the upload names its task by id only, so without
    this check any signed-in user could replace someone else's conversation.
    """
    from sqlalchemy import delete
    from src.models.task import TaskMessage
    from src.services.task_summary import (
        derive_prompt,
        derive_title,
        message_metrics,
        refresh_task_summary,
    )

    # Get-or-create the parent task, owned by the uploading user. The row is
    # in the database before any message is inserted (FK on task_id).
    task, _created = await _get_or_create_task(db, task_id, user_id)
    if task.user_id != user_id:
        raise TaskNotOwnedError(task_id)
    _stamp_workspace_path(task, workspace_path)
    await _link_task_tree(db, task_id)

    # Replace any existing messages for this task (idempotent re-share).
    await db.execute(delete(TaskMessage).where(TaskMessage.task_id == task_id))

    # The token/cost figures are parsed here, once, and stored alongside the
    # message so the task rollup is a numeric SUM rather than a re-parse of the
    # whole conversation on every page view (see services/task_summary).
    from src.services.session_quality import classify_conversation

    parsed: list[dict] = [m for m in messages if isinstance(m, dict)]
    # Quality markers need the conversation in order (a user_feedback means
    # something different when an attempt_completion is awaiting an answer), and
    # a backfill has the whole thing in hand — so classify it in one walk. The
    # marks line up with `parsed`, so a counter walks them alongside `messages`.
    marks = classify_conversation(parsed)
    next_mark = 0

    for msg in messages:
        is_dict = isinstance(msg, dict)
        kind, tool_path = (None, None)
        if is_dict:
            kind, tool_path = marks[next_mark]
            next_mark += 1
        task_msg = TaskMessage(
            task_id=task_id,
            message_data=msg if isinstance(msg, str) else json.dumps(msg),
            message_ts=msg.get("ts") if is_dict else None,
            q_kind=kind,
            tool_path=tool_path,
            **message_metrics(msg if is_dict else {}).as_columns(),
        )
        db.add(task_msg)
    await db.flush()

    # A re-share replaces the whole conversation, so the title and its excerpt
    # are re-derived from scratch (force=True): the row may still carry the
    # placeholder set when the live bridge created the task before any
    # text-bearing message.
    await refresh_task_summary(
        db,
        task_id,
        title=derive_title(parsed),
        prompt=derive_prompt(parsed),
        force_title=True,
    )


async def upsert_task_message(
    db: AsyncSession,
    task_id: str,
    user_id: str,
    message: dict,
    workspace_path: str | None = None,
) -> bool:
    """Insert or update a single live-streamed task message.

    Returns whether the task belongs to ``user_id`` (it did, or it did not
    exist and was just created for them). False means the task is someone
    else's and nothing was written; the bridge relays an event only on True,
    and caches the answer so later chunks need no lookup of their own.

    Used by the remote-control bridge: a ClineMessage streams through several
    states (created → partial updates → final) under one `ts`. We get-or-create
    the parent Task (so a live task becomes visible in the web list) and upsert
    the row keyed by (task_id, ts) so the read-only history mirrors the live view
    instead of accumulating duplicate partial rows.

    The collapse is done with a dialect-native `INSERT … ON CONFLICT DO UPDATE`
    on the `(task_id, message_ts)` unique index. A non-atomic SELECT-then-write
    raced under rapid partial events (streaming reasoning), leaving duplicate
    `partial:true` rows that the finalizing update could never clean up.

    The `DO UPDATE` is **monotonic** so a streamed message can only advance
    toward its most-complete form. Without a guard, the concurrent per-event
    transactions for one `ts` serialize on the unique-index row lock and the
    *last to commit* wins — non-deterministically an early, short partial —
    freezing the row at truncated text + `partial:true`. The web view then shows
    only the opening words of a reasoning trace (e.g. "The user says").

    The guard:
    - A **final** message (`partial` falsy) is authoritative and always wins. It
      carries the full accumulated text, and there is exactly one per `ts`.
    - A **partial** may only overwrite when its payload is at least as long as
      the stored one. Streamed `partial:true` chunks carry the *accumulated*
      text (`_reasoningMessage += chunk`), so their `message_data` grows
      monotonically — a late, short partial is rejected and can never clobber a
      fuller payload or a finalize already in place.

    (Length only fails as a key across the partial→final boundary, where the
    final drops the `"partial":true"` flag and can be a few bytes shorter despite
    longer text — which is exactly why finals bypass the length check.)
    """
    from sqlalchemy import func
    from src.models.task import TaskMessage
    from src.services.session_quality import tool_path_of
    from src.services.task_summary import message_metrics

    if not isinstance(message, dict):
        return False

    task, created = await _get_or_create_task(db, task_id, user_id)
    if task.user_id != user_id:
        # Never let a bridge event write into (or read from) another user's
        # task.
        return False

    ts = message.get("ts")
    payload = json.dumps(message)
    metrics = message_metrics(message).as_columns()
    quality = {
        "q_kind": await _live_quality_kind(db, task_id, message, ts),
        "tool_path": tool_path_of(message),
    }
    # Stamp the project/worktree root on first sight (set on create, and fill a
    # legacy NULL the first time the bridge reports a path). Never overwrites.
    _stamp_workspace_path(task, workspace_path)
    if created:
        # Wire the new row into the subtask tree, once. A chunk carries no
        # parent information, so for a row that already exists the link queries
        # could only find what the moments that change the tree already
        # handled: a relation arriving later stamps the existing row itself
        # (record_relation), and a parent row created later claims this one
        # (its own first chunk or backfill). Running them on every streamed
        # revision cost two to four queries per chunk for nothing.
        await _link_task_tree(db, task_id)

    dialect = db.bind.dialect.name
    if ts is not None and dialect in ("postgresql", "sqlite"):
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as _insert
        else:
            from sqlalchemy.dialects.sqlite import insert as _insert

        is_final = not message.get("partial")
        base = _insert(TaskMessage).values(
            task_id=task_id, message_data=payload, message_ts=ts, **metrics, **quality
        )
        on_conflict = dict(
            index_elements=["task_id", "message_ts"],
            set_={
                "message_data": base.excluded.message_data,
                # The metrics and quality marker travel with the payload: an
                # `api_req_started` only learns its real token/cost figures in
                # its final revision, so a stale row must be corrected, not left
                # behind.
                **{name: getattr(base.excluded, name) for name in (*metrics, *quality)},
            },
        )
        if not is_final:
            # A partial may only advance the row, never shrink it, so a
            # late-committing early partial can't clobber a fuller payload. A
            # final bypasses this (authoritative, one per ts) — it may legitimately
            # be a few bytes shorter than the last partial once `partial:true` is
            # dropped.
            on_conflict["where"] = func.length(base.excluded.message_data) >= func.length(
                TaskMessage.message_data
            )
        stmt = base.on_conflict_do_update(**on_conflict)
        await db.execute(stmt)
        await db.flush()
        await _refresh_after_live_write(db, task_id, message, is_final)
        return True

    # ts is None (legacy/backfill) or an exotic dialect: just append.
    db.add(TaskMessage(task_id=task_id, message_data=payload, message_ts=ts, **metrics, **quality))
    await db.flush()
    await _refresh_after_live_write(db, task_id, message, not message.get("partial"))
    return True


async def _refresh_after_live_write(
    db: AsyncSession,
    task_id: str,
    message: dict,
    is_final: bool,
) -> None:
    """Re-roll the task summary after a live message, but only when it can change.

    A streaming message is upserted many times per second while `partial` is
    true, and none of those revisions can move the totals: a partial
    ``api_req_started`` has no cost yet, and the row's ``ts`` (which sets the
    task's timespan) was already recorded by its first revision. Refreshing on
    finals only cuts the aggregate down to roughly one per conversation step
    while leaving the stored summary exactly as correct — the final revision of
    every message always arrives.

    The live web view reads its header numbers from the socket stream, not from
    this summary, so nothing on screen lags because of the skipped refreshes.
    """
    if not is_final:
        return

    from src.services.task_summary import derive_prompt, derive_title, refresh_task_summary

    # Only a text-bearing message can supply a title, and only the first one
    # ever does — refresh_task_summary keeps an existing title as-is.
    has_text = bool(message.get("text"))
    candidate = derive_title([message]) if has_text else None
    await refresh_task_summary(
        db,
        task_id,
        title=candidate,
        prompt=derive_prompt([message]) if has_text else None,
    )
