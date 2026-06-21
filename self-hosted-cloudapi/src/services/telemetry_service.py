"""Telemetry event recording service."""

import json
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.event import TelemetryEvent


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
    event = TelemetryEvent(
        user_id=user_id,
        organization_id=org_id,
        event_type=event_type,
        properties=json.dumps(properties),
    )
    db.add(event)
    await db.flush()


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
    """
    from sqlalchemy import select, delete
    from src.models.task import Task, TaskMessage

    # Get-or-create the parent task, owned by the uploading user.
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        task = Task(id=task_id, user_id=user_id)
        db.add(task)
        # Flush the new parent before inserting messages (FK on task_id).
        await db.flush()
    _stamp_workspace_path(task, workspace_path)

    # Replace any existing messages for this task (idempotent re-share).
    await db.execute(delete(TaskMessage).where(TaskMessage.task_id == task_id))

    for msg in messages:
        ts = msg.get("ts") if isinstance(msg, dict) else None
        task_msg = TaskMessage(
            task_id=task_id,
            message_data=json.dumps(msg) if not isinstance(msg, str) else msg,
            message_ts=ts,
        )
        db.add(task_msg)
    await db.flush()


async def upsert_task_message(
    db: AsyncSession,
    task_id: str,
    user_id: str,
    message: dict,
    workspace_path: str | None = None,
) -> None:
    """Insert or update a single live-streamed task message.

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
    from sqlalchemy import func, select
    from src.models.task import Task, TaskMessage

    if not isinstance(message, dict):
        return

    ts = message.get("ts")
    payload = json.dumps(message)

    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        task = Task(id=task_id, user_id=user_id)
        db.add(task)
        await db.flush()
    elif task.user_id != user_id:
        # Never let a bridge event write into another user's task.
        return
    # Stamp the project/worktree root on first sight (set on create, and fill a
    # legacy NULL the first time the bridge reports a path). Never overwrites.
    _stamp_workspace_path(task, workspace_path)

    dialect = db.bind.dialect.name
    if ts is not None and dialect in ("postgresql", "sqlite"):
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as _insert
        else:
            from sqlalchemy.dialects.sqlite import insert as _insert

        is_final = not message.get("partial")
        base = _insert(TaskMessage).values(
            task_id=task_id, message_data=payload, message_ts=ts
        )
        on_conflict = dict(
            index_elements=["task_id", "message_ts"],
            set_={"message_data": base.excluded.message_data},
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
        return

    # ts is None (legacy/backfill) or an exotic dialect: just append.
    db.add(TaskMessage(task_id=task_id, message_data=payload, message_ts=ts))
    await db.flush()
