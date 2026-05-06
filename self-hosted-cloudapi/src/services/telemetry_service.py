"""Telemetry event recording service."""

import json
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.event import TelemetryEvent


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
) -> None:
    """Backfill task messages."""
    from src.models.task import TaskMessage

    for msg in messages:
        task_msg = TaskMessage(
            task_id=task_id,
            message_data=json.dumps(msg) if not isinstance(msg, str) else msg,
        )
        db.add(task_msg)
    await db.flush()
