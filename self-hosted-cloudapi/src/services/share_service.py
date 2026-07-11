"""Task sharing service."""

import json
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from config.settings import settings
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

    # Check for existing share
    result = await db.execute(
        select(TaskShare).where(TaskShare.task_id == task_id)
    )
    existing_share = result.scalar_one_or_none()

    # Absolute URLs so the link the extension copies to the clipboard is
    # directly openable in a browser.
    base = settings.api_base_url.rstrip("/")
    share_url = f"{base}/shared/{task_id}"
    manage_url = f"{base}/app/tasks/{task_id}"

    if existing_share:
        # Refresh visibility and (legacy relative) URLs to the absolute form.
        existing_share.visibility = visibility
        existing_share.share_url = share_url
        existing_share.manage_url = manage_url
        await db.flush()
        return ShareResponse(
            success=True,
            share_url=share_url,
            is_new_share=False,
            manage_url=manage_url,
        )

    # Create new share
    share = TaskShare(
        task_id=task_id,
        visibility=visibility,
        share_url=share_url,
        manage_url=manage_url,
    )
    db.add(share)
    await db.flush()

    return ShareResponse(
        success=True,
        share_url=share_url,
        is_new_share=True,
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

    Children are deleted explicitly (messages, then shares, then the task)
    rather than via ORM relationship cascade: under async SQLAlchemy the cascade
    would try to lazy-load ``task.messages``/``task.shares``, which raises.
    """
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None or task.user_id != user_id:
        return False

    await db.execute(delete(TaskMessage).where(TaskMessage.task_id == task_id))
    await db.execute(delete(TaskShare).where(TaskShare.task_id == task_id))
    await db.execute(delete(Task).where(Task.id == task_id))
    await db.flush()
    return True
