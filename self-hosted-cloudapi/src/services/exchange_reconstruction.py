"""Rebuild every recorded request of a task in full, from its deltas and blobs.

An exchange's payload names its base (``baseId``) and keeps the first ``keep``
messages of the base's conversation, then appends its own; the system prompt,
the tool definitions and large wire fields are blob references. Resolving a
task's exchanges in time order gives each one its complete canonical request
(system, tools, messages, params) and, when the extension captured it, the
HTTP body exactly as the provider received it. That body is re-serialized the
way JavaScript's JSON.stringify does and checked against the SHA-256 the
extension recorded (``wire_verified``).

An exchange whose base or blob is missing cannot be rebuilt and is marked
INCOMPLETE, and so is every exchange that builds on it.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.llm_exchange import LlmBlob, LlmExchange
from src.services.exchange_quality import (
    INCOMPLETE,
    result_issues,
    split_issues,
)


@dataclass
class Exchange:
    """One exchange, rebuilt."""

    id: str
    task_id: str
    base_id: Optional[str]
    sequence: int
    occurred_at: Any
    model_id: Optional[str]
    provider: Optional[str]
    mode: Optional[str]
    workspace_path: Optional[str]
    status: str
    retry_attempt: int
    system: Optional[str]
    tools: Optional[list]
    messages: Optional[list]
    params: dict
    response: dict
    error: Optional[dict]
    outcome: Optional[dict]
    stored_issues: list[str]
    complete: bool
    wire: Optional[dict] = None  # url, format, bodySha256, bodyBytes
    wire_body: Optional[dict] = None
    wire_verified: Optional[bool] = None
    _wire_arrays: dict[str, list] = field(default_factory=dict, repr=False)
    issues: list[str] = field(default_factory=list)

    @property
    def tool_call_ids(self) -> list[str]:
        return [c["id"] for c in self.response.get("toolCalls") or [] if isinstance(c, dict) and c.get("id")]


# --- JSON.stringify ------------------------------------------------------------------


def _js_number(value: float) -> str:
    """A float the way JavaScript's Number#toString writes it."""
    if math.isnan(value) or math.isinf(value):
        return "null"
    if value == 0:
        return "0"
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" not in text:
        return text
    mantissa, exponent = text.split("e")
    power = int(exponent)
    if -7 < power < 21:
        # JavaScript writes 1e-6 <= |x| < 1e21 in plain notation.
        return format(Decimal(text), "f")
    return f"{mantissa}e{'+' if power > 0 else '-'}{abs(power)}"


def js_json(value: Any) -> str:
    """``value`` serialized exactly like JSON.stringify(value) (no spacing)."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(js_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(f"{json.dumps(str(k), ensure_ascii=False)}:{js_json(v)}" for k, v in value.items()) + "}"
    raise TypeError(f"not JSON: {type(value).__name__}")


def _verify(body: dict, wire: dict) -> bool:
    try:
        text = js_json(body).encode("utf-8")
    except (TypeError, UnicodeEncodeError, RecursionError):
        return False
    return len(text) == wire.get("bodyBytes") and hashlib.sha256(text).hexdigest() == wire.get("bodySha256")


# --- resolution ----------------------------------------------------------------------


def _blob_json(blobs: dict[str, str], ref: Any) -> tuple[bool, Any]:
    if not isinstance(ref, dict) or ref.get("sha256") not in blobs:
        return False, None
    try:
        return True, json.loads(blobs[ref["sha256"]])
    except ValueError:
        return False, None


def _apply(base_list: Optional[list], delta: Any) -> Optional[list]:
    """base[:keep] + append, or None when the delta cannot apply."""
    if not isinstance(delta, dict) or not isinstance(delta.get("append"), list):
        return None
    keep = delta.get("keep")
    if not isinstance(keep, int) or keep < 0:
        return None
    if keep == 0:
        return list(delta["append"])
    if base_list is None or keep > len(base_list):
        return None
    return base_list[:keep] + delta["append"]


def _build(row: LlmExchange, base: Optional[Exchange], blobs: dict[str, str], verify_wire: bool) -> Exchange:
    payload = json.loads(row.payload)
    request = payload.get("request") or {}
    complete = True
    if row.base_id and (base is None or not base.complete):
        complete = False

    system_ref = request.get("system") or {}
    system = blobs.get(system_ref.get("sha256")) if isinstance(system_ref, dict) else None
    if system is None:
        complete = False
    ok, tools = _blob_json(blobs, request.get("tools"))
    if not ok:
        complete = False
        tools = None

    messages = _apply(base.messages if base else None, request.get("messages"))
    if messages is None or len(messages) != request.get("messageCount"):
        complete = False

    exchange = Exchange(
        id=row.id,
        task_id=row.task_id,
        base_id=row.base_id,
        sequence=row.sequence,
        occurred_at=row.occurred_at,
        model_id=row.model_id,
        provider=row.provider,
        mode=row.mode,
        workspace_path=row.workspace_path,
        status=row.status,
        retry_attempt=int(payload.get("retryAttempt") or 0),
        system=system,
        tools=tools,
        messages=messages,
        params=request.get("params") or {},
        response=payload.get("response") or {},
        error=payload.get("error"),
        outcome=json.loads(row.outcome) if row.outcome else None,
        stored_issues=split_issues(row.issues),
        complete=complete,
    )

    wire = request.get("wire")
    if isinstance(wire, dict):
        exchange.wire = {k: wire.get(k) for k in ("url", "format", "bodySha256", "bodyBytes")}
        fields = wire.get("fields")
        if isinstance(fields, list):
            body: dict = {}
            whole = True
            base_arrays = base._wire_arrays if base and base.complete else {}
            for item in fields:
                if not isinstance(item, dict) or not isinstance(item.get("key"), str):
                    whole = False
                    continue
                key, kind = item["key"], item.get("kind")
                if kind == "value":
                    body[key] = item.get("value")
                elif kind == "blob":
                    found, value = _blob_json(blobs, item.get("blob"))
                    whole = whole and found
                    body[key] = value
                elif kind == "array":
                    rebuilt = _apply(base_arrays.get(key), item.get("delta"))
                    if rebuilt is None:
                        whole = False
                        rebuilt = []
                    exchange._wire_arrays[key] = rebuilt
                    body[key] = rebuilt
                else:
                    whole = False
            if whole:
                exchange.wire_body = body
                exchange.wire_verified = _verify(body, wire) if verify_wire else None
            else:
                exchange.wire_verified = False
    return exchange


def _time_key(row: LlmExchange):
    return (row.occurred_at, row.sequence, row.created_at)


def reconstruct(rows: Iterable[LlmExchange], blobs: dict[str, str], verify_wire: bool = False) -> list[Exchange]:
    """Every exchange of one task, rebuilt, in time order."""
    ordered = sorted(rows, key=_time_key)
    by_id = {row.id: row for row in ordered}
    done: dict[str, Exchange] = {}
    for row in ordered:
        # Walk back to a full snapshot (or a missing base), then forward.
        chain = [row]
        cursor = row
        while cursor.base_id and cursor.base_id not in done:
            parent = by_id.get(cursor.base_id)
            if parent is None or parent in chain:
                break
            chain.append(parent)
            cursor = parent
        for link in reversed(chain):
            if link.id in done:
                continue
            done[link.id] = _build(link, done.get(link.base_id) if link.base_id else None, blobs, verify_wire)
    rebuilt = [done[row.id] for row in ordered]
    _judge(rebuilt)
    return rebuilt


def tool_results_index(exchanges: Iterable[Exchange]) -> dict[str, dict]:
    """tool_use_id -> the tool_result block a later request sent for it."""
    results: dict[str, dict] = {}
    for exchange in exchanges:
        for message in exchange.messages or []:
            if not isinstance(message, dict) or message.get("role") != "user":
                continue
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("tool_use_id"):
                    results[block["tool_use_id"]] = block
    return results


def _judge(exchanges: list[Exchange]) -> None:
    """Final issues: the stored ones, INCOMPLETE, and tool failures seen in later requests."""
    results = tool_results_index(exchanges)
    for exchange in exchanges:
        issues = set(exchange.stored_issues)
        if not exchange.complete:
            issues.add(INCOMPLETE)
        if exchange.outcome is None and exchange.status == "completed":
            issues.update(result_issues(exchange.tool_call_ids, results))
        exchange.issues = sorted(issues)


async def load_task(db: AsyncSession, user_id: str, task_id: str, verify_wire: bool = False) -> list[Exchange]:
    """The user's exchanges of one task, rebuilt (empty when there are none)."""
    rows = list(
        (
            await db.scalars(
                select(LlmExchange).where(LlmExchange.user_id == user_id, LlmExchange.task_id == task_id)
            )
        ).all()
    )
    if not rows:
        return []
    blob_rows = await db.execute(
        select(LlmBlob.sha256, LlmBlob.content).where(LlmBlob.user_id == user_id, LlmBlob.task_id == task_id)
    )
    blobs = {sha: content for sha, content in blob_rows.all()}
    return reconstruct(rows, blobs, verify_wire)
