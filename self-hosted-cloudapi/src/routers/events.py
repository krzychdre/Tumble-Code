"""Telemetry events router.

Implements endpoints:
- POST /api/events
- POST /api/events/backfill
"""

import json
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.schemas.telemetry import TelemetryEventRequest
from src.services.telemetry_service import record_event, backfill_messages
from src.realtime.hub import registry
from config.settings import settings

router = APIRouter(prefix="/api", tags=["events"])


@router.post("/events")
async def record_event_endpoint(
    body: TelemetryEventRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a telemetry event."""
    if not settings.telemetry_enabled:
        return {"status": "ignored"}

    await record_event(
        db=db,
        user_id=current_user["user_id"],
        org_id=current_user.get("org_id"),
        event_type=body.type,
        properties=body.properties or {},
    )
    return {"status": "ok"}


@router.post("/events/backfill")
async def backfill_events_endpoint(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Backfill task messages (FormData).

    Accepts multipart form data with:
    - taskId: string
    - properties: JSON string
    - file: task.json file
    """
    if not settings.telemetry_enabled:
        return {"status": "ignored"}

    form = await request.form()
    task_id = form.get("taskId", "")
    properties = form.get("properties", "{}")
    file = form.get("file")

    messages = []
    if file:
        content = await file.read()
        try:
            messages = json.loads(content.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            messages = []

    # Project/worktree root: prefer the explicit client field (works even when the
    # bridge is offline); fall back to the live registered instance for older
    # clients that don't send it.
    user_id = current_user["user_id"]
    workspace_path = form.get("workspacePath") or None
    if not workspace_path:
        workspace_path = (registry.instance(user_id) or {}).get("workspacePath")

    await backfill_messages(
        db=db,
        task_id=task_id,
        user_id=user_id,
        messages=messages,
        workspace_path=workspace_path,
    )
    return {"status": "ok"}
