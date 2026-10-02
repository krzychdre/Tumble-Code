"""The problem report (/app/diagnostics): what goes wrong, whose fault, what to do.

Counting error telemetry was not enough: on the live deployment it held 1743
code-index errors without a word of detail and not one exception, while the
real problems (tool calls without their parameters, empty answers, requests
past the context window) were only visible inside synced conversations. This
module reads every place a problem is recorded, turns each into one
``Occurrence``, groups the occurrences by signature and looks every group up
in the catalogue (services/problem_catalogue) for its class and mitigation.

Three sources, one shape:

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

Filters (class, category, model, provider, tool, source, free text) and the
sort run after the period's occurrences are collected: they are a few
thousand rows at most, and filtering in Python lets one filter apply to all
three sources alike. The period stays in SQL.

Cost: the period is a WHERE clause on an indexed column in all three queries;
the list reads the indexed columns of ``error_reports``, never ``payload``,
which is read for the drill-down and for the samples of the agent brief (at
most three per group, services/problem_brief). Grouping runs in a worker
thread, like the metrics page.
"""

from __future__ import annotations

import bisect
import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Iterable, Optional, Sequence

import anyio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.error_report import ErrorReport
from src.models.event import TelemetryEvent
from src.models.task import Task, TaskMessage
from src.services.metrics_service import DEFAULT_PERIOD, PERIOD_LABELS, PERIODS, period_start
from src.services.model_attribution import Completion, completion_from_properties, match_requests
from src.services.problem_catalogue import (
    CLASS_BY_KEY,
    CLASS_KEYS,
    CONFIGURATION,
    MODEL,
    PROVIDER,
    SOFTWARE,
    UNCLASSIFIED,
    Rule,
    classify,
    headline,
    mitigation_for,
    problem_signature,
)
from src.services.session_quality import KIND_ERROR, KIND_REQUEST, KIND_RETRY
from src.services.telemetry_vocab import ERROR_EVENT_LABELS, LLM_COMPLETION_EVENT, parse_event_props

SOURCE_REPORT = "report"
SOURCE_CONVERSATION = "conversation"
SOURCE_TELEMETRY = "telemetry"

SOURCE_LABELS = {
    SOURCE_REPORT: "error report",
    SOURCE_CONVERSATION: "synced conversation",
    SOURCE_TELEMETRY: "telemetry event",
}

# The category each error event stands for. Events the extension sends
# without a message are still a category the catalogue knows.
TELEMETRY_CATEGORIES: dict[str, str] = {
    "Exception": "exception",
    "Code Index Error": "code_index",
    "Diff Application Error": "diff_error",
    "Consecutive Mistake Error": "mistake_limit",
    "Schema Validation Error": "settings_invalid",
    "Shell Integration Error": "shell_integration",
    "Model Cache Empty Response": "model_list_empty",
}

# Where an error event says it happened and what it said, tried in order.
_WHERE_KEYS = ("location", "schemaName", "operation", "context")
_MESSAGE_KEYS = ("errorMessage", "error")

# Problems that are not about the chat model: an embedder or Qdrant failing,
# the terminal, a settings file, the model list. They stay on the problem list
# but are left out of the model fit table, where they would read as the chat
# model's fault (1743 code-index errors against "openai (unknown)" on the live
# deployment).
NOT_MODEL_CATEGORIES = frozenset({"code_index", "shell_integration", "settings_invalid", "model_list_empty"})

UNKNOWN_MODEL = "(unknown)"
MAX_GROUPS = 60
# Distinct occurrences a group keeps as evidence for the agent brief.
MAX_SAMPLES = 3
# Report ids listed under a group, newest first.
MAX_GROUP_REPORTS = 5
# The longest legacy message kept for a group's sample.
SAMPLE_TEXT_MAX = 4000
# SQLite caps the parameters of one statement; IN lists are sent in chunks.
_IN_CHUNK = 500

# The classes in the order the page lists their totals.
CLASS_ORDER = (SOFTWARE, MODEL, PROVIDER, CONFIGURATION, UNCLASSIFIED)


@dataclass
class Occurrence:
    """One problem, from whichever source recorded it."""

    source: str
    category: str
    tool: Optional[str]
    # What the catalogue matches and the signature is cut from: the report's
    # summary, the message's text, the event's message.
    text: str
    when: datetime
    task_id: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    mode: Optional[str] = None
    report_id: Optional[str] = None
    signature: str = field(default="")
    # The stored message's ts (conversation source): where the brief finds
    # the messages before it.
    ts: Optional[int] = None
    app_version: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.signature:
            self.signature = problem_signature(self.category, self.tool, self.text)


def _utc(stamp: datetime) -> datetime:
    # SQLite hands timestamps back naive; they are stored in UTC.
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def _fmt_when(stamp: datetime) -> str:
    return _utc(stamp).strftime("%Y-%m-%d %H:%M")


def _text(props: dict, keys: Sequence[str]) -> str:
    for key in keys:
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _chunks(items: list, size: int = _IN_CHUNK) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


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
    return _utc(fallback) if fallback else datetime.now(timezone.utc)


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
    for chunk in _chunks(task_ids):
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
    for chunk in _chunks(task_ids):
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


def conversation_occurrences(
    rows: Sequence[tuple],
    requests: dict[str, list[tuple[int, tuple[int, int]]]],
    completions: dict[str, list[Completion]],
) -> list[Occurrence]:
    """The error messages as occurrences, each with the model that caused it.

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
            )
        )
    return occurrences


# --- the telemetry source -----------------------------------------------------


def telemetry_occurrence(event_type: str, payload, created_at: datetime, task_id: Optional[str]) -> Optional[Occurrence]:
    """One error event as an occurrence; None when its payload is unreadable."""
    props = parse_event_props(payload)
    if props is None:
        return None
    message = _text(props, _MESSAGE_KEYS)
    where = _text(props, _WHERE_KEYS)
    name = _text(props, ("errorName",))
    # What the event says, or its label when it says nothing (an event from
    # an extension that sent no properties of its own).
    text = " ".join(part for part in (name, where, message) if part) or ERROR_EVENT_LABELS[event_type]
    return Occurrence(
        source=SOURCE_TELEMETRY,
        category=TELEMETRY_CATEGORIES.get(event_type, "exception"),
        tool=None,
        text=text[:SAMPLE_TEXT_MAX],
        when=_utc(created_at),
        task_id=task_id or (props.get("taskId") if isinstance(props.get("taskId"), str) else None),
        model=_text(props, ("modelId",)) or None,
        provider=_text(props, ("apiProvider", "provider")) or None,
        mode=_text(props, ("mode",)) or None,
        app_version=_text(props, ("appVersion",)) or None,
    )


# --- filters -------------------------------------------------------------------

SORT_IMPACT = "impact"
SORT_COUNT = "count"
SORT_RECENT = "recent"
SORT_LABELS = {SORT_IMPACT: "Impact", SORT_COUNT: "Occurrences", SORT_RECENT: "Last seen"}

# The order the filters appear in every URL and in the brief's header.
FILTER_FIELDS = ("class", "category", "model", "provider", "tool", "source", "q")
FILTER_LABELS = {
    "class": "Class",
    "category": "Category",
    "model": "Model",
    "provider": "Provider",
    "tool": "Tool",
    "source": "Source",
    "q": "Search",
}
_FILTER_TEXT_MAX = 200


def _param(value) -> str:
    return value.strip()[:_FILTER_TEXT_MAX] if isinstance(value, str) else ""


@dataclass(frozen=True)
class ProblemFilter:
    """One state of the problem report: period, filters and sort.

    Read from the query string by ``parse``, which never fails: a class, a
    source or a sort it does not know is dropped (a stale or hand-edited link
    lands on the unfiltered list, not on an error), the period falls back to
    the default. Category, model, provider and tool are free text compared
    exactly, so a shared link for a model that has no problems in the chosen
    period shows an empty list that says so. ``klass`` is a class key
    (``CLASS_KEYS``), the URL's ``class``.
    """

    period: str = DEFAULT_PERIOD
    klass: str = ""
    category: str = ""
    model: str = ""
    provider: str = ""
    tool: str = ""
    source: str = ""
    q: str = ""
    sort: str = SORT_IMPACT

    @classmethod
    def parse(cls, params) -> "ProblemFilter":
        """From a mapping of query parameters (``request.query_params``)."""
        get = params.get
        period = get("period")
        klass = get("class")
        source = get("source")
        sort = get("sort")
        return cls(
            period=period if period in PERIODS else DEFAULT_PERIOD,
            klass=klass if klass in CLASS_BY_KEY else "",
            category=_param(get("category")),
            model=_param(get("model")),
            provider=_param(get("provider")),
            tool=_param(get("tool")),
            source=source if source in SOURCE_LABELS else "",
            q=_param(get("q")),
            sort=sort if sort in SORT_LABELS else SORT_IMPACT,
        )

    def value(self, name: str) -> str:
        return self.klass if name == "class" else getattr(self, name)

    def label(self, name: str) -> str:
        """The filter's value as the page says it ("Model mismatch", not "model")."""
        value = self.value(name)
        if name == "class":
            return CLASS_BY_KEY.get(value, value)
        if name == "source":
            return SOURCE_LABELS.get(value, value)
        return value

    @property
    def active(self) -> bool:
        return any(self.value(name) for name in FILTER_FIELDS)

    def without(self, *names: str) -> "ProblemFilter":
        changes = {("klass" if name == "class" else name): "" for name in names}
        return replace(self, **changes)

    def describe(self) -> str:
        """The active filters in one line, for the brief's header."""
        parts = [f"{FILTER_LABELS[name].lower()} {self.label(name)!r}" for name in FILTER_FIELDS if self.value(name)]
        return ", ".join(parts) if parts else "none"

    def matches(self, occurrence: "Occurrence", rule: Rule, *, ignore_class: bool = False) -> bool:
        if self.klass and not ignore_class and CLASS_KEYS[rule.classification] != self.klass:
            return False
        if self.category and occurrence.category != self.category:
            return False
        if self.model and (occurrence.model or UNKNOWN_MODEL) != self.model:
            return False
        if self.provider and (occurrence.provider or "") != self.provider:
            return False
        if self.tool and (occurrence.tool or "") != self.tool:
            return False
        if self.source and occurrence.source != self.source:
            return False
        if self.q:
            needle = self.q.lower()
            haystacks = (rule.title, occurrence.signature, occurrence.text)
            if not any(needle in (h or "").lower() for h in haystacks):
                return False
        return True


# --- grouping ------------------------------------------------------------------


def group_key(signature: str) -> str:
    """A short, stable, URL-safe name for a group: its brief's address.

    The signature itself carries spaces, quotes and paths; 12 hex digits of
    its SHA-256 are enough to tell a user's few dozen groups apart.
    """
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:12]


def rules_by_signature(occurrences: Sequence[Occurrence]) -> dict[str, Rule]:
    """Each signature's catalogue rule, decided by its latest occurrence.

    Computed over the whole period before any filter, so a filter never
    changes which class a problem is in.
    """
    latest: dict[str, Occurrence] = {}
    for o in occurrences:
        if o.signature not in latest or o.when > latest[o.signature].when:
            latest[o.signature] = o
    return {sig: classify(o.category, o.tool, o.text) for sig, o in latest.items()}


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


def _sample_view(o: Occurrence) -> dict:
    return {
        "source": o.source,
        "source_label": SOURCE_LABELS[o.source],
        "text": o.text,
        "headline": headline(o.text),
        "when": _fmt_when(o.when),
        "task_id": o.task_id,
        "model": o.model,
        "provider": o.provider,
        "mode": o.mode,
        "report_id": o.report_id,
        "ts": o.ts,
        "app_version": o.app_version,
        "category": o.category,
        "tool": o.tool,
    }


def _counted(counter: Counter) -> list[dict]:
    return [{"value": value, "count": count} for value, count in counter.most_common()]


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
        "first_seen": _fmt_when(first.when),
        "last_seen": _fmt_when(latest.when),
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
        "reports": [{"id": o.report_id, "when": _fmt_when(o.when)} for o in reports[:MAX_GROUP_REPORTS]],
        "sample": _sample_view(latest),
        "samples": [_sample_view(o) for o in pick_samples(members)],
    }


_SORTS = {
    SORT_IMPACT: lambda g: (-g["reach"], -g["count"], -g["last_ts"], g["signature"]),
    SORT_COUNT: lambda g: (-g["count"], -g["reach"], -g["last_ts"], g["signature"]),
    SORT_RECENT: lambda g: (-g["last_ts"], -g["reach"], -g["count"], g["signature"]),
}


def group_occurrences(
    occurrences: Sequence[Occurrence], rules: Optional[dict[str, Rule]] = None, sort: str = SORT_IMPACT
) -> list[dict]:
    """Groups by signature, the most far-reaching first.

    Ranked by reach (see ``_group_view``), then by count, then by how recently
    the problem was last seen; ``sort`` puts count or recency first instead.
    ``rules`` fixes each signature's rule (see ``rules_by_signature``); without
    it the group's latest occurrence decides.
    """
    by_signature: dict[str, list[Occurrence]] = {}
    for occurrence in occurrences:
        by_signature.setdefault(occurrence.signature, []).append(occurrence)
    groups = [
        _group_view(signature, members, (rules or {}).get(signature)) for signature, members in by_signature.items()
    ]
    groups.sort(key=_SORTS.get(sort, _SORTS[SORT_IMPACT]))
    return groups


def model_fit(occurrences: Sequence[Occurrence], groups: Sequence[dict], requests: Counter) -> list[dict]:
    """Per provider and model: requests, problems, problems per 100 requests.

    ``requests`` counts the period's LLM Completion events by
    ``(provider, model)``. A model with many problems per request on one kind
    of problem (a tool call without its parameters) is a model that does not
    fit the protocol; the same problem spread evenly over every model is ours.
    """
    class_of = {g["signature"]: g["classification"] for g in groups}
    rows: dict[tuple[str, str], dict] = {}

    def slot(provider: str, model: str) -> dict:
        return rows.setdefault(
            (provider, model),
            {"provider": provider, "model": model, "requests": 0, "problems": 0,
             "categories": Counter(), "classes": Counter()},
        )

    for (provider, model), count in requests.items():
        slot(provider, model)["requests"] += count
    for o in occurrences:
        if o.category in NOT_MODEL_CATEGORIES:
            continue
        row = slot(o.provider or "", o.model or UNKNOWN_MODEL)
        row["problems"] += 1
        row["categories"][o.category] += 1
        row["classes"][class_of.get(o.signature, UNCLASSIFIED)] += 1

    # A problem without a provider is attributed to the model alone; when that
    # model ran under exactly one provider in the period, fold it in there.
    providers_of: dict[str, list[str]] = {}
    for provider, model in rows:
        if provider:
            providers_of.setdefault(model, []).append(provider)
    for (provider, model) in list(rows):
        if provider or len(providers_of.get(model, [])) != 1:
            continue
        lone = rows.pop((provider, model))
        target = rows[(providers_of[model][0], model)]
        target["requests"] += lone["requests"]
        target["problems"] += lone["problems"]
        target["categories"].update(lone["categories"])
        target["classes"].update(lone["classes"])

    out = []
    for row in rows.values():
        if not row["problems"] and not row["requests"]:
            continue
        top_category = row["categories"].most_common(1)
        top_class = row["classes"].most_common(1)
        out.append(
            {
                "provider": row["provider"],
                "model": row["model"],
                "requests": row["requests"],
                "problems": row["problems"],
                "per_100": round(row["problems"] * 100.0 / row["requests"], 1) if row["requests"] else None,
                "top_category": top_category[0][0] if top_category else "",
                "top_category_count": top_category[0][1] if top_category else 0,
                "top_class": top_class[0][0] if top_class else "",
            }
        )
    out.sort(key=lambda r: (-r["problems"], -(r["per_100"] or 0), -r["requests"], r["model"]))
    return out


def _options(occurrences: Sequence[Occurrence], rules: dict[str, Rule]) -> dict[str, list[dict]]:
    """What each filter can be set to in the period, with how many occurrences.

    From the unfiltered period, so every choice stays visible after one is
    made; the most frequent first, classes and sources in their fixed order.
    """
    counters = {name: Counter() for name in ("category", "model", "provider", "tool")}
    classes: Counter = Counter()
    sources: Counter = Counter()
    for o in occurrences:
        counters["category"][o.category] += 1
        counters["model"][o.model or UNKNOWN_MODEL] += 1
        if o.provider:
            counters["provider"][o.provider] += 1
        if o.tool:
            counters["tool"][o.tool] += 1
        classes[CLASS_KEYS[rules[o.signature].classification]] += 1
        sources[o.source] += 1
    options = {
        name: [{"value": v, "label": v, "count": n} for v, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))]
        for name, c in counters.items()
    }
    options["class"] = [
        {"value": CLASS_KEYS[name], "label": name, "count": classes.get(CLASS_KEYS[name], 0)}
        for name in CLASS_ORDER
        if classes.get(CLASS_KEYS[name])
    ]
    options["source"] = [
        {"value": key, "label": label, "count": sources[key]} for key, label in SOURCE_LABELS.items() if sources.get(key)
    ]
    return options


def aggregate_problems(
    occurrences: Sequence[Occurrence],
    requests: Counter,
    period: str,
    legacy_until: Optional[datetime],
    filters: Optional[ProblemFilter] = None,
    key: Optional[str] = None,
) -> dict:
    """The page's figures from the occurrences; pure, no database.

    With ``filters`` the totals, the groups and the model fit count only the
    matching occurrences. The class tiles count everything the other filters
    let through, so each tile says what clicking it would show. The model
    fit's request counts are the period's, narrowed only by a model or
    provider filter (a request has no category or tool). ``key`` keeps the
    one group with that ``group_key`` (a group's own brief).
    """
    filters = filters or ProblemFilter(period=period)
    rules = rules_by_signature(occurrences)
    unclassed = [o for o in occurrences if filters.matches(o, rules[o.signature], ignore_class=True)]
    if key is not None:
        unclassed = [o for o in unclassed if group_key(o.signature) == key]
    selected = [o for o in unclassed if filters.matches(o, rules[o.signature])]
    groups = group_occurrences(selected, rules, filters.sort)
    by_class = Counter()
    for o in unclassed:
        by_class[rules[o.signature].classification] += 1
    if filters.model or filters.provider:
        requests = Counter(
            {
                (provider, model): count
                for (provider, model), count in requests.items()
                if (not filters.model or model == filters.model) and (not filters.provider or provider == filters.provider)
            }
        )
    return {
        "period": period,
        "period_label": PERIOD_LABELS.get(period, period),
        "has_data": bool(occurrences),
        "period_total": len(occurrences),
        "filtered": filters.active,
        "total": len(selected),
        "tasks": len({o.task_id for o in selected if o.task_id}),
        "by_class": [
            {"name": name, "key": CLASS_KEYS[name], "count": by_class.get(name, 0)} for name in CLASS_ORDER
        ],
        "groups": groups[:MAX_GROUPS],
        "hidden_groups": max(0, len(groups) - MAX_GROUPS),
        "model_fit": model_fit(selected, groups, requests),
        "sources": dict(Counter(o.source for o in selected)),
        "legacy_until": _fmt_when(legacy_until) if legacy_until else None,
        "options": _options(occurrences, rules),
        "sort": filters.sort,
    }


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
    ).where(ErrorReport.user_id == user_id)
    if start is not None:
        stmt = stmt.where(ErrorReport.created_at >= start)
    return [
        Occurrence(
            source=SOURCE_REPORT,
            category=category,
            tool=tool,
            text=summary,
            when=_utc(occurred_at),
            task_id=task_id,
            model=model,
            provider=provider,
            mode=mode,
            report_id=report_id,
            signature=signature,
            app_version=app_version,
        )
        for report_id, category, tool, summary, signature, occurred_at, task_id, model, provider, mode, app_version in (
            await db.execute(stmt)
        ).all()
    ]


async def _telemetry_occurrences(db, user_id, start, cutoff) -> list[Occurrence]:
    stmt = select(
        TelemetryEvent.event_type, TelemetryEvent.properties, TelemetryEvent.created_at, TelemetryEvent.task_id
    ).where(TelemetryEvent.user_id == user_id, TelemetryEvent.event_type.in_(tuple(ERROR_EVENT_LABELS)))
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if cutoff is not None:
        stmt = stmt.where(TelemetryEvent.created_at < cutoff)
    out = []
    for event_type, payload, created_at, task_id in (await db.execute(stmt)).all():
        occurrence = telemetry_occurrence(event_type, payload, created_at, task_id)
        if occurrence is not None:
            out.append(occurrence)
    return out


async def _request_counts(db, user_id: str, start: Optional[datetime]) -> Counter:
    """The period's LLM Completion events by ``(provider, model)``."""
    stmt = select(TelemetryEvent.properties).where(
        TelemetryEvent.user_id == user_id, TelemetryEvent.event_type == LLM_COMPLETION_EVENT
    )
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
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
    return _utc(stamp) if stamp else None


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
        occurrences += await anyio.to_thread.run_sync(conversation_occurrences, rows, requests, completions)
        occurrences += await _telemetry_occurrences(db, user_id, start, cutoff)
    return occurrences, cutoff


async def compute_user_problems(
    db: AsyncSession,
    user_id: str,
    period: str = DEFAULT_PERIOD,
    now: Optional[datetime] = None,
    filters: Optional[ProblemFilter] = None,
    key: Optional[str] = None,
) -> dict:
    """The user's problem report over ``period``, narrowed by ``filters``.

    ``filters.period``, when given, wins over ``period``; ``key`` narrows it
    to one group (see ``aggregate_problems``).
    """
    if filters is not None:
        period = filters.period
    if period not in PERIODS:
        period = DEFAULT_PERIOD
    filters = replace(filters, period=period) if filters is not None else ProblemFilter(period=period)
    start = period_start(period, now)
    occurrences, cutoff = await collect_occurrences(db, user_id, start)
    requests = await _request_counts(db, user_id, start)
    return await anyio.to_thread.run_sync(aggregate_problems, occurrences, requests, period, cutoff, filters, key)


# --- one report ----------------------------------------------------------------


def _num(value) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


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
        "occurred": _fmt_when(row.occurred_at),
        "received": _fmt_when(row.created_at),
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
                 if _num(payload.get("maxOutputTokens")) else None),
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


async def load_report(db: AsyncSession, user_id: str, report_id: str) -> Optional[dict]:
    """The drill-down of one report, or None unless ``user_id`` owns it."""
    row = await db.scalar(
        select(ErrorReport).where(ErrorReport.id == report_id, ErrorReport.user_id == user_id)
    )
    return report_view(row) if row is not None else None
