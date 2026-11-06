"""Telemetry events router.

Implements endpoints:
- POST /api/events
- POST /api/events/backfill
"""

import json

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.middleware.rate_limit import not_rate_limited
from src.dependencies import get_current_user
from src.schemas.telemetry import TelemetryEventRequest
from src.services.client_kind import client_kind_from
from src.services.telemetry_service import (
    TaskNotOwnedError,
    record_event,
    backfill_messages,
)
from src.realtime.hub import registry
from src.routers.upload_gate import upload_slot
from config.settings import settings


def _too_large(limit: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"Upload larger than {limit} bytes",
    )


def capped_request(request: Request, limit: int) -> Request:
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


# Largest single event, in bytes. An event is one message of a conversation:
# the largest of 336 827 real ones measured 5 156 172 bytes.
MAX_EVENT_BYTES = 16 * 1024 * 1024

router = APIRouter(prefix="/api", tags=["events"])


def _backfill_client_kind(properties) -> str | None:
    """The client a backfill's ``properties`` form field names, if any.

    The field is the extension's telemetry properties as JSON text. None when
    it is missing, not JSON, or says nothing about the client: the task's row
    then keeps what it has (see telemetry_service.stamp_task_client).
    """
    if not isinstance(properties, str) or not properties:
        return None
    try:
        fields = json.loads(properties)
    except json.JSONDecodeError:
        return None
    if not isinstance(fields, dict) or not (
        "clientKind" in fields or "editorName" in fields
    ):
        return None
    return client_kind_from(fields)


def _parse_backfill_upload(content: bytes) -> list:
    """The uploaded ClineMessage[] (an empty list when it is not valid JSON).

    Pure and CPU-bound (a real conversation runs to 10 MB), so the route runs
    it in a worker thread.
    """
    try:
        return json.loads(content.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return []


# Outside the per-IP limit: the extension sends one event per chat message,
# streamed partial messages included, so a running task alone sends far more
# than the limit. The Bearer token and the size cap guard it.
@router.post("/events")
@not_rate_limited
async def record_event_endpoint(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a telemetry event. Refused with 413 above ``MAX_EVENT_BYTES``.

    The body is read by hand rather than declared as a parameter: FastAPI
    reads and parses a declared body before the Bearer check runs, so an
    anonymous caller could have this unthrottled route parse it.
    """
    if not settings.telemetry_enabled:
        return {"status": "ignored"}

    raw = await capped_request(request, MAX_EVENT_BYTES).body()
    try:
        # json.loads, as FastAPI does: pydantic's own parser refuses the lone
        # surrogates a JavaScript string can carry.
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Body is not valid JSON"
        )
    try:
        body = TelemetryEventRequest.model_validate(data)
    except ValidationError as exc:
        raise RequestValidationError(
            exc.errors(include_url=False, include_context=False)
        )

    await record_event(
        db=db,
        user_id=current_user["user_id"],
        org_id=current_user.get("org_id"),
        event_type=body.type,
        properties=body.properties or {},
        client_event_id=body.client_event_id,
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

    Refused with 413 above ``BACKFILL_MAX_BYTES``; read and parsed inside an
    ``upload_slot``.
    """
    if not settings.telemetry_enabled:
        return {"status": "ignored"}

    user_id = current_user["user_id"]
    async with upload_slot(user_id):
        form = await capped_request(request, settings.backfill_max_bytes).form()
        file = form.get("file")
        messages = []
        if file:
            content = await file.read()
            messages = await anyio.to_thread.run_sync(_parse_backfill_upload, content)
    task_id = form.get("taskId", "")

    # Project/worktree root: prefer the explicit client field (works even when the
    # bridge is offline); fall back to the live registered instance for older
    # clients that don't send it.
    workspace_path = form.get("workspacePath") or None
    if not workspace_path:
        workspace_path = (registry.instance(user_id) or {}).get("workspacePath")

    try:
        await backfill_messages(
            db=db,
            task_id=task_id,
            user_id=user_id,
            organization_id=current_user["org_id"],
            messages=messages,
            workspace_path=workspace_path,
            client_kind=_backfill_client_kind(form.get("properties")),
        )
    except TaskNotOwnedError:
        # Same answer as /api/extension/share for a task the caller does not
        # own: 404, so the response does not reveal that the id is taken.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    return {"status": "ok"}
