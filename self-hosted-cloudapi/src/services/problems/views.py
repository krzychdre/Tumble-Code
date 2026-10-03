"""How a problem group or one report is laid out for the page.

A group is one row of the problem list (``_group_view``); the samples kept
under it are the agent brief's evidence (``_sample_view``,
``services/problem_brief``). One stored report in full is the drill-down
page (``report_view``).
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from typing import Optional, Sequence

from src.models.error_report import ErrorReport
from src.services.problem_catalogue import (
    CLASS_KEYS,
    Rule,
    classify,
    headline,
    mitigation_for,
)
from src.services.problems.base import (
    MAX_GROUP_REPORTS,
    MAX_SAMPLES,
    SOURCE_LABELS,
    UNKNOWN_MODEL,
    Occurrence,
    fmt_when,
)


def group_key(signature: str) -> str:
    """A short, stable, URL-safe name for a group: its brief's address.

    The signature itself carries spaces, quotes and paths; 12 hex digits of
    its SHA-256 are enough to tell a user's few dozen groups apart.
    """
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:12]


def _num(value) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _counted(counter: Counter) -> list[dict]:
    return [{"value": value, "count": count} for value, count in counter.most_common()]


def _sample_view(o: Occurrence) -> dict:
    return {
        "source": o.source,
        "source_label": SOURCE_LABELS[o.source],
        "text": o.text,
        "headline": headline(o.text),
        "when": fmt_when(o.when),
        "task_id": o.task_id,
        "model": o.model,
        "provider": o.provider,
        "mode": o.mode,
        "report_id": o.report_id,
        "ts": o.ts,
        "app_version": o.app_version,
        "category": o.category,
        "tool": o.tool,
        "client": o.client,
    }


def _group_view(signature: str, members: list[Occurrence], rule: Optional[Rule] = None) -> dict:
    """One row of the problem list: the members of a signature, summarized."""
    latest = max(members, key=lambda o: o.when)
    first = min(members, key=lambda o: o.when)
    tasks = {o.task_id for o in members if o.task_id}
    # Reach: tasks the problem hit, plus the days it hit outside any task (a
    # code-index error belongs to no task). It ranks a problem that spoiled
    # twenty runs above one that fired two hundred times in one burst.
    days = {o.when.date() for o in members if not o.task_id}
    models = Counter((o.provider or "", o.model or UNKNOWN_MODEL) for o in members)
    providers = Counter(o.provider for o in members if o.provider)
    tools = Counter(o.tool for o in members if o.tool)
    known_models = Counter(o.model for o in members if o.model)
    top_model = next((m for (_p, m), _n in models.most_common() if m != UNKNOWN_MODEL), None)
    top_provider = providers.most_common(1)[0][0] if providers else None
    tool = tools.most_common(1)[0][0] if tools else latest.tool

    rule = rule or classify(latest.category, latest.tool, latest.text)
    reports = sorted((o for o in members if o.report_id), key=lambda o: o.when, reverse=True)
    return {
        "signature": signature,
        "key": group_key(signature),
        "category": latest.category,
        "tool": tool,
        "rule": rule.id,
        "title": rule.title,
        "classification": rule.classification,
        "class_key": CLASS_KEYS[rule.classification],
        "mitigation": mitigation_for(rule, top_model, top_provider, tool),
        "count": len(members),
        "tasks": len(tasks),
        "reach": len(tasks) + len(days),
        "task_ids": sorted(tasks)[:MAX_GROUP_REPORTS],
        "first_seen": fmt_when(first.when),
        "last_seen": fmt_when(latest.when),
        "last_ts": latest.when.timestamp(),
        "top_model": top_model,
        "top_provider": top_provider,
        # Other models named in the group, for the row's "+N more".
        "more_models": max(0, len(known_models) - 1),
        "models": [
            {"provider": provider, "model": model, "count": count}
            for (provider, model), count in models.most_common()
        ],
        "providers": _counted(providers),
        "modes": _counted(Counter(o.mode for o in members if o.mode)),
        "versions": _counted(Counter(o.app_version for o in members if o.app_version)),
        "sources": sorted({SOURCE_LABELS[o.source] for o in members}),
        "reports": [{"id": o.report_id, "when": fmt_when(o.when)} for o in reports[:MAX_GROUP_REPORTS]],
        "sample": _sample_view(latest),
        "samples": [_sample_view(o) for o in pick_samples(members)],
    }


def report_view(row: ErrorReport) -> dict:
    """One stored report, laid out for the drill-down page."""
    try:
        payload = json.loads(row.payload or "{}")
    except (json.JSONDecodeError, TypeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}

    window = _num(payload.get("contextWindow"))
    used = _num(payload.get("contextTokens"))
    percent = round(used * 100.0 / window, 1) if window and used is not None else None

    messages = [
        m for m in (request.get("messages") or []) if isinstance(m, dict) and isinstance(m.get("content"), str)
    ]
    tool_calls = [c for c in (response.get("toolCalls") or []) if isinstance(c, dict)]
    rule = classify(row.category, row.tool_name, "\n".join(filter(None, [row.summary, payload.get("errorMessage")])))

    def pretty(value) -> str:
        return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) if value else ""

    return {
        "id": row.id,
        "category": row.category,
        "summary": row.summary,
        "signature": row.signature,
        "title": rule.title,
        "classification": rule.classification,
        "class_key": CLASS_KEYS[rule.classification],
        "mitigation": mitigation_for(rule, row.model_id, row.provider, row.tool_name),
        "occurred": fmt_when(row.occurred_at),
        "received": fmt_when(row.created_at),
        "error_message": payload.get("errorMessage") or "",
        "tool_result": payload.get("toolResult") or "",
        "facts": [
            (label, value)
            for label, value in (
                ("Provider", row.provider),
                ("Model", row.model_id),
                ("Mode", row.mode),
                ("Tool", row.tool_name),
                ("Version", row.app_version),
                ("Editor", payload.get("editorName")),
                ("Platform", payload.get("platform")),
                ("Context window", f"{int(window):,}" if window else None),
                ("Context used", f"{int(used):,} tokens" + (f" ({percent}%)" if percent is not None else "")
                 if used is not None else None),
                ("Max output tokens", f"{int(_num(payload.get('maxOutputTokens'))):,}"
                 if _num(payload.get('maxOutputTokens')) else None),
                ("Messages in context", payload.get("messageCount")),
                ("HTTP status", payload.get("httpStatus")),
                ("Retry attempt", payload.get("retryAttempt")),
            )
            if value not in (None, "")
        ],
        "task_id": row.task_id,
        "context_percent": percent,
        "request": {
            "system_prompt_chars": _num(request.get("systemPromptChars")),
            "system_prompt_sha256": request.get("systemPromptSha256") or "",
            "tool_names": [t for t in (request.get("toolNames") or []) if isinstance(t, str)],
            "params": pretty(request.get("params")),
            "messages": [{"role": str(m.get("role") or "?"), "content": m["content"]} for m in messages],
        },
        "response": {
            "text": response.get("text") or "",
            "reasoning": response.get("reasoning") or "",
            "tool_calls": [
                {"id": c.get("id") or "", "name": str(c.get("name") or "?"), "arguments": str(c.get("arguments") or "")}
                for c in tool_calls
            ],
            "stop_reason": response.get("stopReason") or "",
            "error_body": response.get("errorBody") or "",
            "usage": pretty(response.get("usage")),
        },
        "has_request": bool(request),
        "has_response": bool(response),
    }


def pick_samples(members: Sequence[Occurrence], limit: int = MAX_SAMPLES) -> list[Occurrence]:
    """Up to ``limit`` distinct occurrences to show an agent, best evidence first.

    Reports first (they carry the request and the response), newest first;
    then one per model and task before a second from the same model or task,
    and never two with the same text from the same task.
    """
    ordered = sorted(members, key=lambda o: (o.report_id is None, -o.when.timestamp()))
    picked: list[Occurrence] = []
    models: set[str] = set()
    tasks: set[str] = set()
    seen: set[tuple] = set()

    def task_of(o: Occurrence) -> str:
        return o.task_id or f"day:{o.when.date()}"

    passes = (
        lambda o: (o.model or UNKNOWN_MODEL) not in models and task_of(o) not in tasks,
        lambda o: (o.model or UNKNOWN_MODEL) not in models or task_of(o) not in tasks,
        lambda o: True,
    )
    for accept in passes:
        for o in ordered:
            if len(picked) >= limit:
                return picked
            identity = (task_of(o), o.model, o.text)
            if identity in seen or not accept(o):
                continue
            picked.append(o)
            seen.add(identity)
            models.add(o.model or UNKNOWN_MODEL)
            tasks.add(task_of(o))
    return picked
