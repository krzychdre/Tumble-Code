"""Telemetry events router.

Implements endpoints:
- POST /api/events
- POST /api/events/backfill
"""

import json

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from starlette.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.schemas.telemetry import TelemetryEventRequest
from src.services.telemetry_service import TaskNotOwnedError, record_event, backfill_messages
from src.realtime.hub import registry
from config.settings import settings

router = APIRouter(prefix="/api", tags=["events"])


def _too_large(limit: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"Upload larger than {limit} bytes",
    )


def _capped(request: Request, limit: int) -> Request:
    """The request, refused with 413 once its body passes ``limit`` bytes.

    A declared Content-Length above the cap is refused before a byte is read.
    A body without one (chunked) is counted as it arrives, so the multipart
    parser never gets further than the cap either.
    """
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise _too_large(limit)

    received = 0

    async def receive() -> Message:
        nonlocal received
        message = await request.receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > limit:
                raise _too_large(limit)
        return message

    return Request(request.scope, receive)


def _parse_backfill_upload(content: bytes) -> list:
    """The uploaded ClineMessage[] (an empty list when it is not valid JSON).

    Pure and CPU-bound (a real conversation runs to 10 MB), so the route runs
    it in a worker thread.
    """
    try:
        return json.loads(content.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return []


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

    Refused with 413 above ``BACKFILL_MAX_BYTES``.
    """
    if not settings.telemetry_enabled:
        return {"status": "ignored"}

    form = await _capped(request, settings.backfill_max_bytes).form()
    task_id = form.get("taskId", "")
    file = form.get("file")

    messages = []
    if file:
        content = await file.read()
        messages = await anyio.to_thread.run_sync(_parse_backfill_upload, content)

    # Project/worktree root: prefer the explicit client field (works even when the
    # bridge is offline); fall back to the live registered instance for older
    # clients that don't send it.
    user_id = current_user["user_id"]
    workspace_path = form.get("workspacePath") or None
    if not workspace_path:
        workspace_path = (registry.instance(user_id) or {}).get("workspacePath")

    try:
        await backfill_messages(
            db=db,
            task_id=task_id,
            user_id=user_id,
            messages=messages,
            workspace_path=workspace_path,
        )
    except TaskNotOwnedError:
        # Same answer as /api/extension/share for a task the caller does not
        # own: 404, so the response does not reveal that the id is taken.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return {"status": "ok"}
