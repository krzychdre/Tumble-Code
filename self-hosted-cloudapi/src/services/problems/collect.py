"""Reading every place a problem is recorded into one ``Occurrence`` shape.

Three sources:

  report        an ``error_reports`` row: what the extension sends while the
                user is signed in. Has the request and the response, so it is
                the only source with a drill-down.
  conversation  a stored message marked as an error or a provider retry at
                write time (``task_messages.q_kind``, services/session_quality):
                ``say: error``, ``diff_error``, ``rooignore_error``,
                ``api_req_failed``, ``api_req_retry_delayed`` and
                ``ask: mistake_limit_reached``. The model is attributed from
                the request before it (services/model_attribution).
  telemetry     an error event (``telemetry_vocab.ERROR_EVENT_LABELS``), with
                whatever detail the extension version sent.

The last two are the legacy sources. They cover only the time before the
user's first error report: from then on the report says the same thing with
its evidence, and reading both would count every problem twice.

Cost: the period is a WHERE clause on an indexed column in all three queries;
the list reads the indexed columns of ``error_reports``, never ``payload``...
which is read for the drill-down and for the samples of the agent brief (at
most three per group, services/problem_brief).
"""

from __future__ import annotations

import bisect
import json
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

import anyio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.error_report import ErrorReport
from src.models.event import TelemetryEvent
from src.models.task import Task, TaskMessage
from src.services.client_kind import CLIENT_VSCODE
from src.services.model_attribution import Completion, completion_from_properties, match_requests
from src.services.problems.base import (
    MESSAGE_KEYS,
    SAMPLE_TEXT_MAX,
    SOURCE_CONVERSATION,
    SOURCE_REPORT,
    SOURCE_TELEMETRY,
    TELEMETRY_CATEGORIES,
    UNKNOWN_MODEL,
    WHERE_KEYS,
    Occurrence,
    chunks,
    prop_text,
    utc,
)
from src.services.session_quality import KIND_ERROR, KIND_REQUEST, KIND_RETRY
from src.services.telemetry_vocab import ERROR_EVENT_LABELS, LLM_COMPLETION_EVENT, parse_event_props


# --- the conversation source ---------------------------------------------------


def conversation_category(message: dict) -> tuple[str, Optional[str]]:
    """The category and tool of a stored error message.

    Read from the message's own words: an extension that predates error
    reports wrote nothing else. The texts are the extension's fixed error
    strings ("Roo tried to use X without value for required parameter",
    "Error reading file", ...); an unrecognized one is a ``tool_error`` with
    no tool, and the catalogue decides from the text.
    """
    say = message.get("say")
    ask = message.get("ask")
    text = message.get("text") if isinstance(message.get("text"), str) else ""
    lower = text.lower()

    if ask == "mistake_limit_reached":
        return "mistake_limit", None
    if say == "diff_error":
        return "diff_error", "apply_diff"
    if say == "rooignore_error":
        return "rooignore", None
    if say in ("api_req_retry_delayed", "api_req_failed"):
        if "maximum context length" in lower or "context length" in lower:
            return "context_overflow", None
        if "did not provide any assistant messages" in lower:
            return "empty_response", None
        return "api_error", None

    # say: error
    if "model_no_assistant_messages" in lower:
        return "empty_response", None
    if "without value for required parameter" in lower:
        tool = _word_after(text, "tried to use ")
        return "invalid_tool_call", tool
    if lower.startswith("error reading file") or lower.startswith("error extracting text") or lower.startswith(
        "file does not exist"
    ):
        return "tool_error", "read_file"
    if lower.startswith("error listing files"):
        return "tool_error", "list_files"
    if "mcp" in lower:
        return "tool_error", "use_mcp_tool"
    if lower.startswith("web_fetch"):
        return "tool_error", "web_fetch"
    if "artifact" in lower:
        return "tool_error", "read_artifact"
    return "tool_error", None


def _word_after(text: str, marker: str) -> Optional[str]:
    start = text.find(marker)
    if start < 0:
        return None
    rest = text[start + len(marker):].split()
    return rest[0] if rest else None


def _ts_to_datetime(ts: Optional[int], fallback: Optional[datetime]) -> datetime:
    if isinstance(ts, (int, float)) and ts > 0:
        return datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc)
    return utc(fallback) if fallback else datetime.now(timezone.utc)


async def _conversation_rows(db, user_id, start_ms, cutoff_ms) -> list[tuple]:
    """``(task_id, message_ts, message_data, created_at)`` of the period's errors."""
    stmt = (
        select(TaskMessage.task_id, TaskMessage.message_ts, TaskMessage.message_data, TaskMessage.created_at)
        .join(Task, Task.id == TaskMessage.task_id)
        .where(Task.user_id == user_id, TaskMessage.q_kind.in_((KIND_ERROR, KIND_RETRY)))
    )
    if start_ms is not None:
        stmt = stmt.where(TaskMessage.message_ts >= start_ms)
    if cutoff_ms is not None:
        stmt = stmt.where(TaskMessage.message_ts < cutoff_ms)
    return (await db.execute(stmt.order_by(TaskMessage.message_ts))).all()


async def _requests_by_task(db, task_ids: list[str]) -> dict[str, list[tuple[int, tuple[int, int]]]]:
    """Each task's API requests as ``(ts, (tokens_in, tokens_out))``, in order.

    From the token columns stored at write time: no message is decoded.
    """
    requests: dict[str, list] = {}
    for chunk in chunks(task_ids):
        rows = await db.execute(
            select(TaskMessage.task_id, TaskMessage.message_ts, TaskMessage.tokens_in, TaskMessage.tokens_out)
            .where(
                TaskMessage.task_id.in_(chunk),
                TaskMessage.q_kind == KIND_REQUEST,
                TaskMessage.message_ts.is_not(None),
            )
            .order_by(TaskMessage.message_ts)
        )
        for task_id, ts, tin, tout in rows.all():
            requests.setdefault(task_id, []).append((ts, (int(tin or 0), int(tout or 0))))
    return requests


async def _completions_by_task(db, user_id: str, task_ids: list[str]) -> dict[str, list[Completion]]:
    """Each task's completion events (the owner's only), oldest first."""
    completions: dict[str, list[Completion]] = {}
    for chunk in chunks(task_ids):
        rows = await db.execute(
            select(TelemetryEvent.task_id, TelemetryEvent.properties)
            .where(
                TelemetryEvent.user_id == user_id,
                TelemetryEvent.event_type == LLM_COMPLETION_EVENT,
                TelemetryEvent.task_id.in_(chunk),
            )
            .order_by(TelemetryEvent.created_at)
        )
        for task_id, payload in rows.all():
            props = parse_event_props(payload)
            completion = completion_from_properties(props) if props else None
            if completion is not None:
                completions.setdefault(task_id, []).append(completion)
    return completions


async def _task_clients(db, task_ids: list[str]) -> dict[str, str]:
    """Each task's client (``tasks.client_kind``), for its error messages."""
    clients: dict[str, str] = {}
    for chunk in chunks(task_ids):
        rows = await db.execute(select(Task.id, Task.client_kind).where(Task.id.in_(chunk)))
        clients.update({task_id: kind for task_id, kind in rows.all()})
    return clients


def conversation_occurrences(
    rows,
    requests: dict[str, list[tuple[int, tuple[int, int]]]],
    completions: dict[str, list[Completion]],
    clients: Optional[dict[str, str]] = None,
) -> list[Occurrence]:
    """The error messages as occurrences, each with the model that caused it.

    ``clients`` maps a task to its client; a task it does not name is VS Code.

    The model is the one that answered the request before the message: an
    error message is written after the request that produced it. A request
    whose (in, out) tokens are 0 is still in flight and has no answer to
    match, so it is not a candidate (services/model_attribution).
    """
    attributed: dict[str, tuple[list, dict]] = {}
    occurrences: list[Occurrence] = []
    for task_id, ts, payload, created_at in rows:
        try:
            message = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(message, dict):
            continue
        category, tool = conversation_category(message)
        text = message.get("text") if isinstance(message.get("text"), str) else ""

        if task_id not in attributed:
            task_requests = [(t, pair) for t, pair in requests.get(task_id, []) if pair != (0, 0)]
            matched = match_requests(task_requests, completions.get(task_id, []))
            attributed[task_id] = ([t for t, _ in task_requests], matched)
        request_ts, matched = attributed[task_id]
        completion = None
        if isinstance(ts, (int, float)):
            index = bisect.bisect_left(request_ts, ts) - 1
            if index >= 0:
                completion = matched.get(request_ts[index])

        occurrences.append(
            Occurrence(
                source=SOURCE_CONVERSATION,
                category=category,
                tool=tool,
                text=text[:SAMPLE_TEXT_MAX],
                when=_ts_to_datetime(ts, created_at),
                task_id=task_id,
                model=completion.model if completion else None,
                provider=completion.provider if completion else None,
                mode=completion.mode if completion else None,
                ts=int(ts) if isinstance(ts, (int, float)) else None,
                client=(clients or {}).get(task_id, CLIENT_VSCODE),
            )
        )
    return occurrences


# --- the telemetry source -----------------------------------------------------


def telemetry_occurrence(
    event_type: str, payload, created_at: datetime, task_id: Optional[str], client: str = CLIENT_VSCODE
) -> Optional[Occurrence]:
    """One error event as an occurrence; None when its payload is unreadable."""
    props = parse_event_props(payload)
    if props is None:
        return None
    message = prop_text(props, MESSAGE_KEYS)
    where = prop_text(props, WHERE_KEYS)
    name = prop_text(props, ("errorName",))
    # What the event says, or its label when it says nothing (an event from
    # an extension that sent no properties of its own).
    text = " ".join(part for part in (name, where, message) if part) or ERROR_EVENT_LABELS[event_type]
    return Occurrence(
        source=SOURCE_TELEMETRY,
        category=TELEMETRY_CATEGORIES.get(event_type, "exception"),
        tool=None,
        text=text[:SAMPLE_TEXT_MAX],
        when=utc(created_at),
        task_id=task_id or (props.get("taskId") if isinstance(props.get("taskId"), str) else None),
        model=prop_text(props, ("modelId",)) or None,
        provider=prop_text(props, ("apiProvider", "provider")) or None,
        mode=prop_text(props, ("mode",)) or None,
        app_version=prop_text(props, ("appVersion",)) or None,
        client=client,
    )


# --- reading the period --------------------------------------------------------


async def _report_occurrences(db, user_id: str, start: Optional[datetime]) -> list[Occurrence]:
    # The indexed columns only: the payload is for the drill-down.
    stmt = select(
        ErrorReport.id,
        ErrorReport.category,
        ErrorReport.tool_name,
        ErrorReport.summary,
        ErrorReport.signature,
        ErrorReport.occurred_at,
        ErrorReport.task_id,
        ErrorReport.model_id,
        ErrorReport.provider,
        ErrorReport.mode,
        ErrorReport.app_version,
        ErrorReport.client_kind,
    ).where(ErrorReport.user_id == user_id)
    if start is not None:
        stmt = stmt.where(ErrorReport.created_at >= start)
    return [
        Occurrence(
            source=SOURCE_REPORT,
            category=category,
            tool=tool,
            text=summary,
            when=utc(occurred_at),
            task_id=task_id,
            model=model,
            provider=provider,
            mode=mode,
            report_id=report_id,
            signature=signature,
            app_version=app_version,
            client=client,
        )
        for (
            report_id,
            category,
            tool,
            summary,
            signature,
            occurred_at,
            task_id,
            model,
            provider,
            mode,
            app_version,
            client,
        ) in (await db.execute(stmt)).all()
    ]


async def _telemetry_occurrences(db, user_id, start, cutoff) -> list[Occurrence]:
    stmt = select(
        TelemetryEvent.event_type,
        TelemetryEvent.properties,
        TelemetryEvent.created_at,
        TelemetryEvent.task_id,
        TelemetryEvent.client_kind,
    ).where(TelemetryEvent.user_id == user_id, TelemetryEvent.event_type.in_(tuple(ERROR_EVENT_LABELS)))
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if cutoff is not None:
        stmt = stmt.where(TelemetryEvent.created_at < cutoff)
    out = []
    for event_type, payload, created_at, task_id, client in (await db.execute(stmt)).all():
        occurrence = telemetry_occurrence(event_type, payload, created_at, task_id, client)
        if occurrence is not None:
            out.append(occurrence)
    return out


async def _request_counts(db, user_id: str, start: Optional[datetime], client: str = ""):
    """The period's LLM Completion events by ``(provider, model)``, of one
    client when ``client`` names one (the model fit then compares like with
    like)."""
    stmt = select(TelemetryEvent.properties).where(
        TelemetryEvent.user_id == user_id, TelemetryEvent.event_type == LLM_COMPLETION_EVENT
    )
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if client:
        stmt = stmt.where(TelemetryEvent.client_kind == client)
    payloads = [payload for (payload,) in (await db.execute(stmt)).all()]

    def count() -> Counter:
        counts: Counter = Counter()
        for payload in payloads:
            props = parse_event_props(payload)
            if not props:
                continue
            model = props.get("modelId") if isinstance(props.get("modelId"), str) and props.get("modelId") else UNKNOWN_MODEL
            provider = props.get("apiProvider") if isinstance(props.get("apiProvider"), str) else ""
            counts[(provider, model)] += 1
        return counts

    return await anyio.to_thread.run_sync(count)


async def first_report_at(db: AsyncSession, user_id: str) -> Optional[datetime]:
    """When the user's first error report arrived; legacy sources stop there."""
    stamp = await db.scalar(select(func.min(ErrorReport.created_at)).where(ErrorReport.user_id == user_id))
    return utc(stamp) if stamp else None


async def collect_occurrences(
    db: AsyncSession, user_id: str, start: Optional[datetime]
) -> tuple[list[Occurrence], Optional[datetime]]:
    """Every occurrence of the period from the three sources, and the legacy cutoff."""
    cutoff = await first_report_at(db, user_id)
    occurrences = await _report_occurrences(db, user_id, start)

    legacy_open = cutoff is None or start is None or start < cutoff
    if legacy_open:
        start_ms = int(start.timestamp() * 1000) if start else None
        cutoff_ms = int(cutoff.timestamp() * 1000) if cutoff else None
        rows = await _conversation_rows(db, user_id, start_ms, cutoff_ms)
        task_ids = sorted({row[0] for row in rows})
        requests = await _requests_by_task(db, task_ids) if task_ids else {}
        completions = await _completions_by_task(db, user_id, task_ids) if task_ids else {}
        clients = await _task_clients(db, task_ids) if task_ids else {}
        occurrences += await anyio.to_thread.run_sync(conversation_occurrences, rows, requests, completions, clients)
        occurrences += await _telemetry_occurrences(db, user_id, start, cutoff)
    return occurrences, cutoff
