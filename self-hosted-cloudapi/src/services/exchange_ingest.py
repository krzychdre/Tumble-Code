"""Storing LLM exchanges and their outcomes (POST /api/llm-exchanges[/outcome]).

An exchange is written once: the extension generates its id and retries an
upload that got no answer, so the insert is ``ON CONFLICT (id) DO NOTHING``
(the pattern of error_report_service). Blob texts are moved out of the payload
into ``llm_blobs`` (one row per user, task and hash, also ON CONFLICT DO
NOTHING) after their hash is checked; everything else of the payload is stored
exactly as the extension sent it, because the reconstruction must give the
request back unchanged.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import dialect_insert
from src.models.llm_exchange import DatasetSettings, LlmBlob, LlmExchange
from src.schemas.llm_exchange import LlmExchangeOutcomeRequest, LlmExchangeRequest
from src.services.exchange_quality import join_issues, outcome_issues, split_issues, static_issues

COLUMN_MAX = 200


class BlobHashMismatch(ValueError):
    """A blob's text does not hash to the SHA-256 it was sent under."""


def _short(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:COLUMN_MAX]


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --- the dataset switch ---------------------------------------------------------


async def read_dataset_settings(db: AsyncSession, user_id: str) -> Optional[DatasetSettings]:
    """The user's dataset settings, or None when never saved (a GET must not write)."""
    return await db.get(DatasetSettings, user_id)


async def recording_enabled(db: AsyncSession, user_id: str) -> bool:
    settings_row = await read_dataset_settings(db, user_id)
    return bool(settings_row and settings_row.recording_enabled)


async def save_dataset_settings(
    db: AsyncSession, user_id: str, *, recording: bool, terms: Optional[str]
) -> DatasetSettings:
    row = await read_dataset_settings(db, user_id)
    if row is None:
        row = DatasetSettings(user_id=user_id)
        db.add(row)
    row.recording_enabled = recording
    row.anonymize_terms = terms
    await db.flush()
    return row


# --- exchanges ------------------------------------------------------------------


def _blob_refs(payload: dict) -> list[dict]:
    """Every blob reference of a payload (the dicts themselves, to edit in place)."""
    request = payload.get("request") or {}
    refs = [request.get("system"), request.get("tools")]
    wire = request.get("wire") or {}
    for field in wire.get("fields") or []:
        if isinstance(field, dict) and field.get("kind") == "blob":
            refs.append(field.get("blob"))
    return [ref for ref in refs if isinstance(ref, dict)]


def split_blobs(payload: dict) -> dict[str, str]:
    """Move the blob texts out of ``payload`` (in place); returns hash -> text.

    Raises BlobHashMismatch when a text does not hash to its name: storing it
    would make every later exchange of the chain reconstruct wrongly.
    """
    texts: dict[str, str] = {}
    for ref in _blob_refs(payload):
        text = ref.pop("text", None)
        if text is None:
            continue
        if sha256_hex(text) != ref.get("sha256"):
            raise BlobHashMismatch(f"blob {ref.get('sha256')} does not match its text")
        texts[ref["sha256"]] = text
    return texts


async def _tools_of(db: AsyncSession, user_id: str, task_id: str, ref: dict, sent: dict[str, str]) -> Any:
    """The tools the request offered: from this upload's blobs or an earlier one's."""
    sha = ref.get("sha256")
    text = sent.get(sha)
    if text is None:
        text = await db.scalar(
            select(LlmBlob.content).where(
                LlmBlob.user_id == user_id, LlmBlob.task_id == task_id, LlmBlob.sha256 == sha
            )
        )
    try:
        return json.loads(text) if text else []
    except ValueError:
        return []


async def _insert_ignoring_duplicates(db: AsyncSession, model, values: dict, index_elements: list[str]) -> bool:
    upsert_insert = dialect_insert(db)
    if upsert_insert is None:
        key = {name: values[name] for name in index_elements}
        exists = await db.scalar(select(getattr(model, index_elements[0])).filter_by(**key))
        if exists is not None:
            return False
        db.add(model(**values))
        await db.flush()
        return True
    result = await db.execute(
        upsert_insert(model).values(**values).on_conflict_do_nothing(index_elements=index_elements)
    )
    return result.rowcount == 1


async def record_exchange(
    db: AsyncSession, user_id: str, org_id: Optional[str], raw: dict, exchange: LlmExchangeRequest
) -> bool:
    """Store one validated exchange (``raw`` is the parsed body). True when this call inserted it."""
    payload = json.loads(json.dumps(raw))  # a private copy to edit
    texts = split_blobs(payload)
    task_id = exchange.task_id[:COLUMN_MAX]
    now = datetime.now(timezone.utc)
    for sha, text in texts.items():
        await _insert_ignoring_duplicates(
            db,
            LlmBlob,
            {"user_id": user_id, "task_id": task_id, "sha256": sha, "content": text, "created_at": now},
            ["user_id", "task_id", "sha256"],
        )

    response = payload.get("response") or {}
    tools = await _tools_of(db, user_id, task_id, payload["request"]["tools"], texts)
    usage = exchange.response.usage
    values = {
        "id": exchange.id,
        "user_id": user_id,
        "organization_id": org_id,
        "task_id": task_id,
        "base_id": exchange.base_id,
        "sequence": exchange.sequence,
        "occurred_at": datetime.fromtimestamp(exchange.occurred_at / 1000.0, tz=timezone.utc),
        "created_at": now,
        "provider": _short(exchange.provider),
        "model_id": _short(exchange.model_id),
        "mode": _short(exchange.mode),
        "workspace_path": (exchange.workspace_path or None) and exchange.workspace_path[:1000],
        "status": exchange.status[:40],
        "finish_reason": _short(exchange.response.finish_reason),
        "input_tokens": int((usage and usage.input_tokens) or 0),
        "output_tokens": int((usage and usage.output_tokens) or 0),
        "tool_call_count": len(exchange.response.tool_calls or []),
        "has_wire": exchange.request.wire is not None,
        "issues": join_issues(static_issues(exchange.status, response, tools)),
        "payload": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    }
    return await _insert_ignoring_duplicates(db, LlmExchange, values, ["id"])


async def record_outcome(db: AsyncSession, user_id: str, outcome: LlmExchangeOutcomeRequest) -> bool:
    """Attach the tool outcomes to the user's exchange. False when it is not stored (yet)."""
    row = await db.scalar(
        select(LlmExchange).where(LlmExchange.id == outcome.exchange_id, LlmExchange.user_id == user_id)
    )
    if row is None:
        return False
    results = [r.model_dump(by_alias=True, exclude_none=True) for r in outcome.tool_results]
    body: dict[str, Any] = {"toolResults": results}
    if outcome.usage is not None:
        body["usage"] = outcome.usage.model_dump(by_alias=True, exclude_none=True)
    payload = json.loads(row.payload)
    tools_ref = (payload.get("request") or {}).get("tools") or {}
    tools = await _tools_of(db, user_id, row.task_id, tools_ref, {})
    static = static_issues(row.status, payload.get("response") or {}, tools)
    values: dict[str, Any] = {
        "outcome": json.dumps(body, ensure_ascii=False, separators=(",", ":")),
        "issues": join_issues(static, outcome_issues(results)),
    }
    if outcome.usage is not None and outcome.usage.output_tokens:
        values["input_tokens"] = int(outcome.usage.input_tokens or 0)
        values["output_tokens"] = int(outcome.usage.output_tokens or 0)
    await db.execute(update(LlmExchange).where(LlmExchange.id == row.id).values(**values))
    return True


def stored_issues(row: LlmExchange) -> list[str]:
    return split_issues(row.issues)
