"""Task sharing service."""


from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update

from config.settings import settings
from src.database import dialect_insert
from src.models.error_report import ErrorReport
from src.models.llm_exchange import LlmBlob, LlmExchange
from src.models.task import Task, TaskMessage, TaskShare
from src.models.settings import OrganizationSettings
from src.schemas.share import ShareResponse


async def share_task(
    db: AsyncSession,
    task_id: str,
    user_id: str,
    visibility: str = "organization",
) -> ShareResponse:
    """Share a task and return a share URL."""
    # Check if task exists
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()

    if task is None or task.user_id != user_id:
        return ShareResponse(success=False, error="Task not found")

    # Enforce org task-sharing policy server-side.
    #
    # The extension checks canSharePublicly() client-side, but a direct API
    # call can bypass that. We re-check here using the org's settings.
    #
    # Permissive default: when the task has no organization_id, or when no
    # OrganizationSettings row exists for the org (which happens for existing
    # self-hosted deployments that never configured org settings), we allow
    # all sharing. Enforcement applies ONLY when an OrganizationSettings row
    # has been explicitly created for the org — the model defaults
    # (enable_task_sharing=True, allow_public_task_sharing=True) are
    # permissive, so a freshly-created row also allows sharing; only an
    # explicit False on the relevant flag triggers rejection.
    if task.organization_id:
        result = await db.execute(
            select(OrganizationSettings).where(
                OrganizationSettings.organization_id == task.organization_id
            )
        )
        org_settings = result.scalar_one_or_none()
        if org_settings is not None:
            if not org_settings.enable_task_sharing:
                return ShareResponse(
                    success=False,
                    error="Task sharing is disabled for this organization",
                )
            if visibility == "public" and not org_settings.allow_public_task_sharing:
                return ShareResponse(
                    success=False,
                    error="Public task sharing is disabled for this organization",
                )

    # Absolute URLs so the link the extension copies to the clipboard is
    # directly openable in a browser.
    base = settings.api_base_url.rstrip("/")
    share_url = f"{base}/shared/{task_id}"
    manage_url = f"{base}/app/tasks/{task_id}"

    # Race-proof creation, not select-then-insert. Two concurrent share
    # requests (a double click, two tabs) used to both pass the "no share
    # yet" SELECT and both INSERT, leaving two rows for one task — and every
    # reader of a task's share uses scalar_one_or_none(), so the duplicates
    # broke the shared page outright. The unique index uq_task_shares_task_id
    # (migration b4c5d6e7f8a9) backs an ON CONFLICT DO NOTHING insert: exactly
    # one racing caller's row lands (rowcount 1, is_new_share=True); the
    # others conflict and get rowcount 0, then refresh the surviving row.
    # index_elements (never constraint=...): Postgres only accepts ON CONFLICT
    # ON CONSTRAINT for a constraint, not a unique index.
    result = await db.execute(
        dialect_insert(db)(TaskShare)
        .values(
            task_id=task_id,
            visibility=visibility,
            share_url=share_url,
            manage_url=manage_url,
        )
        .on_conflict_do_nothing(index_elements=["task_id"])
    )
    created = result.rowcount == 1

    if not created:
        # A share row already exists (sequential re-share, or a racing caller
        # that lost the insert): refresh visibility and (legacy relative)
        # URLs in place, exactly like the old existing-share branch. A plain
        # UPDATE by task_id — no uniqueness decision left to race.
        await db.execute(
            update(TaskShare)
            .where(TaskShare.task_id == task_id)
            .values(visibility=visibility, share_url=share_url, manage_url=manage_url)
        )
    await db.flush()

    return ShareResponse(
        success=True,
        share_url=share_url,
        is_new_share=created,
        manage_url=manage_url,
    )


async def delete_shared_task(
    db: AsyncSession,
    task_id: str,
    user_id: str,
) -> bool:
    """Permanently remove a task and everything hanging off it from the DB.

    Returns True when the task existed and was owned by ``user_id`` (and is now
    gone), False otherwise — so an unknown id or another user's task is a safe
    no-op, never a leak or an error.
    """
    return await delete_tasks(db, [task_id], user_id) == 1


async def delete_tasks(
    db: AsyncSession,
    task_ids: list[str],
    user_id: str,
    *,
    include_subtasks: bool = False,
) -> int:
    """Delete every task in ``task_ids`` that ``user_id`` owns. Returns the count.

    Ownership is re-checked here against the database rather than trusted from
    the request: a bulk form posts a list of ids, and nothing stops a caller
    from adding somebody else's. Ids that are unknown or owned by another user
    are dropped silently, so a partly-wrong list still deletes exactly the part
    the caller was entitled to delete, and reveals nothing about the rest.

    With ``include_subtasks`` the selection is expanded downwards through the
    task tree first. Without it, a deleted parent's children survive as roots
    rather than disappearing with work the caller never selected.

    Children are deleted explicitly (messages, then shares, then the task)
    rather than via ORM relationship cascade: under async SQLAlchemy the cascade
    would try to lazy-load ``task.messages``/``task.shares``, which raises.
    """
    if not task_ids:
        return 0

    owned = await _owned_ids(db, task_ids, user_id)
    if include_subtasks:
        owned = await _with_descendants(db, owned, user_id)
    if not owned:
        return 0

    # Orphan surviving children explicitly rather than leaving it to the
    # ON DELETE SET NULL on tasks.parent_task_id. Postgres honours that
    # constraint; SQLite does not enforce foreign keys unless the connection
    # asks it to, so the two engines would disagree — and a child left pointing
    # at a deleted parent disappears from the list entirely, because the default
    # view selects on `parent_task_id IS NULL`.
    await db.execute(
        update(Task).where(Task.parent_task_id.in_(owned)).values(parent_task_id=None)
    )

    await db.execute(delete(TaskMessage).where(TaskMessage.task_id.in_(owned)))
    # Error reports carry the tail of the task's conversation; they go with
    # it. Not a foreign key (a report can name a task that was never stored),
    # so it is done here, for this user's reports only.
    await db.execute(
        delete(ErrorReport).where(ErrorReport.task_id.in_(owned), ErrorReport.user_id == user_id)
    )
    # Recorded LLM exchanges and their blobs hold the whole conversation as the
    # model saw it; they go with the task too (also not foreign keys).
    await db.execute(
        delete(LlmExchange).where(LlmExchange.task_id.in_(owned), LlmExchange.user_id == user_id)
    )
    await db.execute(delete(LlmBlob).where(LlmBlob.task_id.in_(owned), LlmBlob.user_id == user_id))
    await db.execute(delete(TaskShare).where(TaskShare.task_id.in_(owned)))
    await db.execute(delete(Task).where(Task.id.in_(owned)))
    await db.flush()
    # `task_relations` rows are deliberately kept. They are the durable record
    # of what telemetry said, they carry no foreign keys, and keeping them means
    # re-sharing a deleted task restores its place in the tree.
    return len(owned)


async def _owned_ids(db: AsyncSession, task_ids: list[str], user_id: str) -> list[str]:
    result = await db.execute(
        select(Task.id).where(Task.id.in_(task_ids), Task.user_id == user_id)
    )
    return [row[0] for row in result.all()]


async def _with_descendants(
    db: AsyncSession, task_ids: list[str], user_id: str, max_depth: int = 20
) -> list[str]:
    """Expand a selection to include every subtask beneath it, at any depth.

    Walked level by level rather than with a recursive CTE so the same code runs
    on SQLite (the test database) and Postgres. Bounded by ``max_depth`` — the
    parent links are built from client-supplied ids, and a cycle must not spin
    here.
    """
    collected = list(task_ids)
    seen = set(collected)
    frontier = collected
    for _ in range(max_depth):
        if not frontier:
            break
        result = await db.execute(
            select(Task.id).where(
                Task.parent_task_id.in_(frontier), Task.user_id == user_id
            )
        )
        frontier = [row[0] for row in result.all() if row[0] not in seen]
        seen.update(frontier)
        collected.extend(frontier)
    return collected
