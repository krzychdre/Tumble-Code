"""Telemetry event recording service."""

import json

import anyio
from sqlalchemy import delete, desc, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import dialect_insert
from src.models.event import TelemetryEvent
from src.models.task import Task, TaskMessage
from src.services.client_kind import CLIENT_CLI, CLIENT_VSCODE, client_kind_from
from src.services.model_attribution import note_completion_model
from src.services.session_quality import (
    KIND_COMPLETION,
    KIND_COMPLETION_REPLY,
    KIND_INTERVENTION,
    KIND_REQUEST,
    KIND_TOOL,
    classify_conversation,
    classify_message,
    tool_path_of,
)
from src.services.task_summary import derive_prompt, derive_title, message_metrics, refresh_task_summary
from src.services.task_tree import adopt_from_relations, link_pending_children, record_relation
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
    await adopt_from_relations(db, task_id)
    await link_pending_children(db, task_id)


async def _get_or_create_task(db, task_id: str, user_id: str, client_kind: str | None = None):
    """Return ``(task, created)``, creating the row for ``user_id`` when missing.

    ``client_kind`` is the client the caller knows the task comes from (a
    backfill says, a bridge message does not). A new row takes it, or else the
    client of the telemetry already stored for the task: events often arrive
    before the row exists. An existing row is left to ``stamp_task_client``.

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
    query = select(Task).where(Task.id == task_id)
    task = (await db.execute(query)).scalar_one_or_none()
    if task is not None:
        return task, False

    if client_kind != CLIENT_CLI:
        client_kind = await _telemetry_client(db, task_id, user_id)

    upsert_insert = dialect_insert(db)
    if upsert_insert is None:
        # No portable ON CONFLICT: keep the plain insert.
        task = Task(id=task_id, user_id=user_id, client_kind=client_kind)
        db.add(task)
        await db.flush()
        return task, True

    result = await db.execute(
        upsert_insert(Task)
        .values(id=task_id, user_id=user_id, client_kind=client_kind)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    created = result.rowcount == 1
    task = (await db.execute(query)).scalar_one()
    return task, created


async def _telemetry_client(db, task_id: str, user_id: str) -> str:
    """The client of the user's telemetry stored for a task not yet stored.

    One indexed lookup (telemetry_events.task_id), once per task: only when its
    row is created.
    """
    cli_event = await db.scalar(
        select(TelemetryEvent.id)
        .where(
            TelemetryEvent.task_id == task_id,
            TelemetryEvent.user_id == user_id,
            TelemetryEvent.client_kind == CLIENT_CLI,
        )
        .limit(1)
    )
    return CLIENT_CLI if cli_event is not None else CLIENT_VSCODE


async def stamp_task_client(db, task_id: str, user_id: str, client_kind: str) -> None:
    """Mark the user's stored task as the CLI's when a record of it says so.

    The only change a task's client ever makes is "vscode" to "cli" (see
    ``Task.client_kind``), so this is one guarded UPDATE that matches nothing
    once the row is marked, and nothing for a VS Code record. Whatever order
    the bridge, the backfill and the telemetry arrive in, the row ends as the
    CLI's if any of them came from it. The owner is part of the condition: an
    event naming another user's task id changes nothing.
    """
    if client_kind != CLIENT_CLI:
        return
    await db.execute(
        update(Task)
        .where(Task.id == task_id, Task.user_id == user_id, Task.client_kind != CLIENT_CLI)
        .values(client_kind=CLIENT_CLI)
        # Task rows loaded in this session are not refreshed; nothing on the
        # ingest paths reads the column back.
        .execution_options(synchronize_session=False)
    )


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
    client_kind = client_kind_from(properties)
    event = TelemetryEvent(
        user_id=user_id,
        organization_id=org_id,
        event_type=event_type,
        # Lifted out of the blob at write time: every reader that asks "what
        # happened in this task" then does an indexed lookup instead of parsing
        # JSON across the whole event corpus.
        task_id=task_id if isinstance(task_id, str) and task_id else None,
        client_kind=client_kind,
        properties=json.dumps(properties),
    )
    db.add(event)
    await db.flush()

    # Which client ran the task: the task's own messages never say, its
    # telemetry does (services/client_kind).
    if event.task_id and user_id:
        await stamp_task_client(db, event.task_id, user_id, client_kind)

    # Telemetry is the only place a subtask states which task spawned it, and
    # it says so long before the subtask exists as a row. Capture the link here
    # so the web view can render the tree. See services/task_tree.
    await record_relation(db, properties, user_id=user_id)

    # …and the only place that says which model answered: a stored
    # `api_req_started` carries tokens and cost but no model. See
    # services/model_attribution.
    if event_type == LLM_COMPLETION_EVENT and event.task_id:
        model = properties.get("modelId")
        if isinstance(model, str) and model:
            await note_completion_model(db, event.task_id, model)


class TaskNotOwnedError(Exception):
    """The task exists but belongs to another user.

    Raised instead of writing, so a caller cannot forget the check: the
    routers answer it with the same 404 the share endpoint gives, which says
    nothing about whether the task exists.
    """


def _build_backfill_rows(task_id: str, messages: list) -> tuple[list[dict], str, str]:
    """The ``task_messages`` rows of an uploaded conversation, and its title and prompt.

    Pure and CPU-bound: a conversation runs to 10 MB (BACKFILL_MAX_BYTES), and
    classifying it, serializing every message and extracting its token/cost
    figures took a few hundred milliseconds of event loop, so the backfill
    runs this in a worker thread (P11). Every row is a plain dict with the
    same keys, ready for one bulk INSERT; the column defaults (``id``,
    ``created_at``) are filled per row by the insert.
    """
    # The token/cost figures are parsed here, once, and stored alongside the
    # message so the task rollup is a numeric SUM rather than a re-parse of the
    # whole conversation on every page view (see services/task_summary).
    parsed: list[dict] = [m for m in messages if isinstance(m, dict)]
    # Quality markers need the conversation in order (a user_feedback means
    # something different when an attempt_completion is awaiting an answer), and
    # a backfill has the whole thing in hand, so classify it in one walk. The
    # marks line up with `parsed`, so a counter walks them alongside `messages`.
    #
    # The walk covers every message, including one that loses its row below:
    # it still happened, and the awaiting state it leaves behind is part of
    # the run (a tool call after a completion makes the next feedback a
    # mid-run correction). Each stored row keeps its own message's mark.
    marks = classify_conversation(parsed)
    next_mark = 0

    # The extension often stamps two consecutive messages with the same ts
    # (an ask/say command_output pair, ask tool + say checkpoint_saved, say
    # reasoning + say text), and (task_id, message_ts) is unique. Store one
    # row per ts holding the LATER message, as the live bridge's upsert does
    # (owner decision 26). Messages without a ts append as before.
    last_index_of_ts = {}
    for index, msg in enumerate(messages):
        ts = msg.get("ts") if isinstance(msg, dict) else None
        if isinstance(ts, (int, float, str)):
            last_index_of_ts[ts] = index

    rows: list[dict] = []
    for index, msg in enumerate(messages):
        is_dict = isinstance(msg, dict)
        kind, tool_path = (None, None)
        if is_dict:
            kind, tool_path = marks[next_mark]
            next_mark += 1
            ts = msg.get("ts")
            if isinstance(ts, (int, float, str)) and last_index_of_ts[ts] != index:
                continue
        rows.append(
            {
                "task_id": task_id,
                "message_data": msg if isinstance(msg, str) else json.dumps(msg),
                "message_ts": msg.get("ts") if is_dict else None,
                "q_kind": kind,
                "tool_path": tool_path,
                **message_metrics(msg if is_dict else {}).as_columns(),
            }
        )
    return rows, derive_title(parsed), derive_prompt(parsed)


async def backfill_messages(
    db: AsyncSession,
    task_id: str,
    user_id: str,
    messages: list,
    workspace_path: str | None = None,
    client_kind: str | None = None,
) -> None:
    """Backfill task messages.

    Ensures the parent Task row exists (owned by the uploading user) before
    inserting messages: TaskMessage.task_id is a FK to tasks.id, so without
    this the insert raises an IntegrityError. Idempotent: re-uploading a task
    (e.g. re-sharing after more turns) replaces the previously stored messages
    rather than appending duplicates.

    `workspace_path` is the project/worktree root (explicit client field, with a
    registry fallback resolved by the caller); stamped on the Task so offline
    tasks show their project in the web view. `client_kind` is the client the
    upload's properties name (None when they name none).

    Raises TaskNotOwnedError, before touching anything, when the task already
    belongs to another user: the upload names its task by id only, so without
    this check any signed-in user could replace someone else's conversation.

    The rows are built in a worker thread (``_build_backfill_rows``) and
    written with one bulk INSERT, not one ORM object per message: the event
    loop only runs the queries (P11).
    """
    # Get-or-create the parent task, owned by the uploading user. The row is
    # in the database before any message is inserted (FK on task_id).
    task, created = await _get_or_create_task(db, task_id, user_id, client_kind)
    if task.user_id != user_id:
        raise TaskNotOwnedError(task_id)
    _stamp_workspace_path(task, workspace_path)
    if not created and client_kind:
        await stamp_task_client(db, task_id, user_id, client_kind)
    await _link_task_tree(db, task_id)

    # Replace any existing messages for this task (idempotent re-share).
    await db.execute(delete(TaskMessage).where(TaskMessage.task_id == task_id))

    rows, title, prompt = await anyio.to_thread.run_sync(_build_backfill_rows, task_id, messages)
    if rows:
        # One Core INSERT executed with the whole list (executemany): no ORM
        # object, identity-map entry or unit-of-work step per row. SQLAlchemy
        # batches the parameters itself, within SQLite's and asyncpg's
        # bound-parameter limits, so this is the same on both dialects.
        await db.execute(insert(TaskMessage), rows)

    # A re-share replaces the whole conversation, so the title and its excerpt
    # are re-derived from scratch (force=True): the row may still carry the
    # placeholder set when the live bridge created the task before any
    # text-bearing message.
    await refresh_task_summary(
        db,
        task_id,
        title=title,
        prompt=prompt,
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

    upsert_insert = dialect_insert(db)
    if ts is not None and upsert_insert is not None:
        is_final = not message.get("partial")
        base = upsert_insert(TaskMessage).values(
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
