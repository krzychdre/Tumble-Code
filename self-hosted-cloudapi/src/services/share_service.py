"""Task sharing service."""

import json
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.models.task import Task, TaskShare
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

    if task is None:
        return ShareResponse(success=False, error="Task not found")

    # Check for existing share
    result = await db.execute(
        select(TaskShare).where(TaskShare.task_id == task_id)
    )
    existing_share = result.scalar_one_or_none()

    if existing_share:
        return ShareResponse(
            success=True,
            share_url=existing_share.share_url,
            is_new_share=False,
            manage_url=existing_share.manage_url,
        )

    # Create new share
    share = TaskShare(
        task_id=task_id,
        visibility=visibility,
        share_url=f"/shared/{task_id}",
        manage_url=f"/manage/{task_id}",
    )
    db.add(share)
    await db.flush()

    return ShareResponse(
        success=True,
        share_url=share.share_url,
        is_new_share=True,
        manage_url=share.manage_url,
    )
