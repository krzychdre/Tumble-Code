"""LLM exchange recording: the switch the extension reads, and the two uploads.

- GET  /api/llm-exchanges/config   {"enabled": bool}: whether to record at all.
- POST /api/llm-exchanges          one exchange (gzip or plain JSON).
- POST /api/llm-exchanges/outcome  how the exchange's tool calls went.

Same Bearer auth as POST /api/events. Nothing is stored unless the user has
switched recording on (/app/dataset) and the deployment takes telemetry; the
answer then says ``recording: false`` so the extension stops sending. See
services/exchange_ingest and ai_plans/2026-10-02_llm-exchange-dataset.md.
"""

import json
import zlib

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.database import get_db
from src.dependencies import get_current_user
from src.middleware.rate_limit import limiter
from src.routers.events import capped_request
from src.schemas.llm_exchange import LlmExchangeOutcomeRequest, LlmExchangeRequest
from src.services.exchange_ingest import (
    BlobHashMismatch,
    base_exists,
    record_exchange,
    record_outcome,
    recording_enabled,
    without_lone_surrogates,
)

router = APIRouter(prefix="/api", tags=["events"])

# Largest body accepted as sent (the extension's own cap, compressed).
MAX_BODY_BYTES = 32 * 1024 * 1024
# Largest body after decompression: a full snapshot of a long conversation is
# megabytes of text; this stops a small gzip bomb from becoming gigabytes.
MAX_INFLATED_BYTES = 128 * 1024 * 1024


def _not_rate_limited(endpoint):
    """Leave the endpoint out of the global per-IP limit (60 requests a minute by default).

    A fast model finishes a turn every few seconds and each turn sends an
    exchange and its outcome, on top of the telemetry events; a refused upload
    makes the extension restart its chain with a full snapshot, which is the
    largest request it ever sends. The Bearer token still guards the endpoint.
    """
    return limiter.exempt(endpoint) if limiter is not None else endpoint


def _inflate(body: bytes, encoding: str) -> bytes:
    if encoding in ("", "identity"):
        return body
    if encoding != "gzip":
        raise HTTPException(status_code=415, detail=f"Unsupported Content-Encoding: {encoding}")
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        data = inflater.decompress(body, MAX_INFLATED_BYTES)
    except zlib.error:
        raise HTTPException(status_code=400, detail="Body is not valid gzip")
    if inflater.unconsumed_tail:
        raise HTTPException(status_code=413, detail=f"Body inflates past {MAX_INFLATED_BYTES} bytes")
    return data


def _parse(body: bytes, encoding: str, model: type[BaseModel]):
    """Inflate, parse and validate (CPU-bound on a large snapshot: run in a thread)."""
    data = _inflate(body, encoding)
    try:
        raw = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Body is not valid JSON")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    raw = without_lone_surrogates(raw)
    try:
        return raw, model.model_validate(raw)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False))


async def _read(request: Request, model: type[BaseModel]):
    body = await capped_request(request, MAX_BODY_BYTES).body()
    encoding = request.headers.get("content-encoding", "").strip().lower()
    return await anyio.to_thread.run_sync(_parse, body, encoding, model)


async def _recording(db: AsyncSession, user_id: str) -> bool:
    return settings.telemetry_enabled and await recording_enabled(db, user_id)


@router.get("/llm-exchanges/config")
@_not_rate_limited
async def llm_exchange_config_endpoint(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Whether the extension should record LLM exchanges for this user."""
    return {"enabled": await _recording(db, current_user["user_id"])}


@router.post("/llm-exchanges")
@_not_rate_limited
async def record_llm_exchange_endpoint(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store one exchange; an id already stored is ignored. Same answer either way."""
    user_id = current_user["user_id"]
    if not await _recording(db, user_id):
        # Switched off since the extension last asked: nothing is read or kept.
        return {"success": True, "stored": False, "recording": False}
    raw, exchange = await _read(request, LlmExchangeRequest)
    # A delta whose base is gone (recordings deleted while the task ran, or a
    # chain begun on another account) cannot be rebuilt: it is stored, marked
    # incomplete by the reconstruction, and the extension is asked to send a
    # full snapshot next.
    resnapshot = bool(exchange.base_id) and not await base_exists(db, user_id, exchange.base_id)
    try:
        stored = await record_exchange(db, user_id, current_user.get("org_id"), raw, exchange)
    except BlobHashMismatch as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    answer = {"success": True, "stored": stored, "recording": True}
    if resnapshot:
        answer["resnapshot"] = True
    return answer


@router.post("/llm-exchanges/outcome")
@_not_rate_limited
async def record_llm_exchange_outcome_endpoint(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Attach the tool outcomes to an exchange the user owns."""
    user_id = current_user["user_id"]
    if not await _recording(db, user_id):
        return {"success": True, "stored": False, "recording": False}
    _, outcome = await _read(request, LlmExchangeOutcomeRequest)
    stored = await record_outcome(db, user_id, outcome)
    return {"success": True, "stored": stored, "recording": True}
