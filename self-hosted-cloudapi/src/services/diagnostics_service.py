"""Errors and feature usage for the web view (/app/diagnostics).

Read from the same ``telemetry_events`` as the metrics page, but from every
event type the metrics page leaves alone: the error events
(``telemetry_vocab.ERROR_EVENT_LABELS``) and everything else the extension
reports as something the user did (a tool call, a mode switch, a checkpoint).
Completions, embeddings and the conversation copies are not part of it.

Errors are grouped by type and by where they happened plus the first line of
their message, digits blanked, so "HTTP 429 after 3 tries" and "after 4 tries"
are one row. Events from extensions older than the one that started sending
the event's own properties carry no detail at all; they are one row per type.

Like the metrics page this loads the rows and aggregates in Python (the
``properties`` column is JSON text and the tests run on SQLite).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional, Sequence

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.event import TelemetryEvent
from src.services.metrics_service import DEFAULT_PERIOD, PERIODS, period_start
from src.services.telemetry_vocab import (
    CONVERSATION_MESSAGE_EVENT,
    EMBEDDING_EVENT,
    ERROR_EVENT_LABELS,
    LLM_COMPLETION_EVENT,
    TASK_MESSAGE_EVENT,
    parse_event_props,
)

# Event types that are neither an error nor a use of a feature.
NOT_DIAGNOSTIC_EVENTS = (
    LLM_COMPLETION_EVENT,
    EMBEDDING_EVENT,
    TASK_MESSAGE_EVENT,
    CONVERSATION_MESSAGE_EVENT,
)

TOOL_USED_EVENT = "Tool Used"

# The property that says which one, for the usage events that have one.
USAGE_DIMENSIONS: dict[str, str] = {
    TOOL_USED_EVENT: "tool",
    "Mode Switched": "newMode",
    "Code Action Used": "actionType",
    "Title Button Clicked": "button",
    "Tab Shown": "tab",
    "Mode Setting Changed": "settingName",
    "Custom Mode Created": "modeSlug",
    "Marketplace Item Installed": "itemName",
    "Marketplace Item Removed": "itemName",
}

# Where an error happened, and what it said, in the order the keys are tried.
_WHERE_KEYS = ("location", "schemaName", "operation", "context")
_MESSAGE_KEYS = ("errorMessage", "error")

# The value an event with no recorded detail is shown under.
NOT_RECORDED = "(not recorded)"

MAX_ERROR_GROUPS = 50
MAX_RECENT_ERRORS = 25
MAX_BREAKDOWN_ROWS = 10


def _text(props: dict, keys: Sequence[str]) -> str:
    """The first non-empty string among ``keys`` in ``props``, else ""."""
    for key in keys:
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _first_line(text: str, limit: int = 200) -> str:
    line = text.splitlines()[0] if text else ""
    return line if len(line) <= limit else line[:limit] + "…"


def error_signature(props: dict) -> str:
    """What one error event is grouped by: where it happened and what it said.

    Errors that never carry a message (a diff that did not apply, the mistake
    limit) fall back to the model of their task, which is the useful split for
    them. An empty string when the event carries none of it (a code-index
    error recorded before the extension sent the event's own properties).
    """
    parts = [
        _text(props, ("errorName",)),
        _text(props, _WHERE_KEYS) or _text(props, ("provider",)),
        _first_line(_text(props, _MESSAGE_KEYS)),
    ]
    if not any(parts):
        parts = [_text(props, ("modelId",))]
    return " · ".join(p for p in parts if p)


def _group_key(signature: str) -> str:
    return re.sub(r"\d+", "#", signature)


def _utc(stamp: datetime) -> datetime:
    # SQLite hands created_at back naive; it is stored in UTC.
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def _fmt_when(stamp: datetime) -> str:
    return _utc(stamp).strftime("%Y-%m-%d %H:%M")


def _error_detail(event_type: str, props: dict, created_at: datetime) -> dict:
    """One error occurrence as the page shows it."""
    message = _text(props, _MESSAGE_KEYS)
    return {
        "event": event_type,
        "label": ERROR_EVENT_LABELS[event_type],
        "when": _fmt_when(created_at),
        "signature": error_signature(props) or NOT_RECORDED,
        "message": message,
        "stack": props.get("stack") if isinstance(props.get("stack"), str) else "",
        "task_id": props.get("taskId") if isinstance(props.get("taskId"), str) else "",
        "model": _text(props, ("modelId",)),
        "provider": _text(props, ("provider", "apiProvider")),
        "version": _text(props, ("appVersion",)),
    }


def _ranked(counts: dict[str, int], limit: Optional[int] = None) -> list[dict]:
    rows = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    if limit is not None and len(rows) > limit:
        rest = sum(count for _, count in rows[limit:])
        rows = rows[:limit] + [(f"{len(rows) - limit} more", rest)]
    return [{"name": name, "count": count} for name, count in rows]


def aggregate_diagnostics(rows: Sequence[tuple], period: str) -> dict:
    """Group the period's events into errors and feature usage.

    ``rows`` are ``(event_type, properties, created_at)`` tuples in
    ``created_at`` order.
    """
    error_total = 0
    errors_by_type: dict[str, int] = {}
    groups: dict[tuple[str, str], dict] = {}
    recent: list[dict] = []

    tool_counts: dict[str, int] = {}
    usage: dict[str, dict] = {}
    usage_total = 0

    for event_type, payload, created_at in rows:
        props = parse_event_props(payload)
        if props is None:
            continue

        if event_type in ERROR_EVENT_LABELS:
            error_total += 1
            errors_by_type[event_type] = errors_by_type.get(event_type, 0) + 1
            detail = _error_detail(event_type, props, created_at)
            key = (event_type, _group_key(detail["signature"]))
            group = groups.get(key)
            if group is None:
                group = groups[key] = {
                    "event": event_type,
                    "label": detail["label"],
                    "count": 0,
                    "first_seen": detail["when"],
                }
            group["count"] += 1
            # Rows come oldest first: the last one seen is the latest sample.
            group["last_seen"] = detail["when"]
            group["sample"] = detail
            recent.append(detail)
            continue

        usage_total += 1
        dimension = USAGE_DIMENSIONS.get(event_type)
        name = (_text(props, (dimension,)) or NOT_RECORDED) if dimension else ""
        if event_type == TOOL_USED_EVENT:
            tool_counts[name] = tool_counts.get(name, 0) + 1
            continue
        slot = usage.setdefault(event_type, {"event": event_type, "count": 0, "by": {}})
        slot["count"] += 1
        if dimension:
            slot["by"][name] = slot["by"].get(name, 0) + 1

    error_groups = sorted(groups.values(), key=lambda g: (-g["count"], g["label"]))
    features = sorted(usage.values(), key=lambda f: (-f["count"], f["event"]))
    for feature in features:
        feature["breakdown"] = _ranked(feature.pop("by"), MAX_BREAKDOWN_ROWS)

    tool_total = sum(tool_counts.values())
    return {
        "period": period,
        "has_data": bool(error_total or usage_total),
        "errors": {
            "total": error_total,
            "by_type": [
                {"event": event, "label": ERROR_EVENT_LABELS[event], "count": count}
                for event, count in sorted(errors_by_type.items(), key=lambda kv: (-kv[1], kv[0]))
            ],
            "groups": error_groups[:MAX_ERROR_GROUPS],
            "hidden_groups": max(0, len(error_groups) - MAX_ERROR_GROUPS),
            "recent": list(reversed(recent[-MAX_RECENT_ERRORS:])),
            "undetailed": sum(g["count"] for g in error_groups if g["sample"]["signature"] == NOT_RECORDED),
        },
        "usage": {
            "total": usage_total,
            "tools": _ranked(tool_counts),
            "tool_total": tool_total,
            "tools_unnamed": tool_counts.get(NOT_RECORDED, 0),
            "tools_named": len([name for name in tool_counts if name != NOT_RECORDED]),
            "features": features,
        },
    }


async def compute_user_diagnostics(
    db: AsyncSession,
    user_id: str,
    period: str = DEFAULT_PERIOD,
    now: Optional[datetime] = None,
) -> dict:
    """The user's errors and feature usage over ``period``."""
    if period not in PERIODS:
        period = DEFAULT_PERIOD
    start = period_start(period, now)

    stmt = select(TelemetryEvent.event_type, TelemetryEvent.properties, TelemetryEvent.created_at).where(
        TelemetryEvent.user_id == user_id,
        TelemetryEvent.event_type.not_in(NOT_DIAGNOSTIC_EVENTS),
    )
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    stmt = stmt.order_by(TelemetryEvent.created_at)

    rows = (await db.execute(stmt)).all()
    return await anyio.to_thread.run_sync(aggregate_diagnostics, rows, period)
