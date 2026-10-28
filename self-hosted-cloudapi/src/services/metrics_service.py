"""Usage-metrics aggregation for the web view: the reader's own, or that of an
organization they administer.

Aggregates the logged-in user's LLM usage from ``telemetry_events`` — NOT from
``task_messages``. Only *shared/live* tasks ever land in ``task_messages``, and
their ``api_req_started`` payload (``ClineApiReqInfo``) carries tokens/cost but
neither the model nor the mode. The ``LLM Completion`` telemetry event, by
contrast, is emitted for every completion and carries the full set of dimensions
the metrics page needs:

    {"mode", "apiProvider", "modelId", "taskId",
     "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "cost"}

Ingest lifts those figures out of the JSON ``properties`` into columns
(``telemetry_vocab.event_columns``), and the page sums them in SQL. Each
statement is a GROUP BY with a row per combination of names, quarter of an
hour, group or indexing source, never one per event; Python only adds those
rows up. The statements read the same on SQLite (the test suite) and
Postgres. Event names and kind labels come from ``services/telemetry_vocab``.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Row,
    Select,
    and_,
    cast,
    distinct,
    extract,
    func,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.event import TelemetryEvent
from src.models.project import Project
from src.models.task import Task
from src.models.user import User
from src.services.client_kind import CLIENT_LABELS
from src.services.projects import visible_to
from src.services.telemetry_vocab import (
    EMBEDDING_EVENT,
    KIND_LABELS,
    LLM_COMPLETION_EVENT,
)
from src.utils.clientzone import UTC, day_start_utc, local_day, today
from src.utils.format import fmt_duration, fmt_tokens

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GroupBy:
    """SQL key and name of the group an event belongs to, over the tables of
    the completions query (web/presenters/metrics_view.GROUPINGS)."""

    key: ColumnElement
    name: ColumnElement
    # The key is the event's task's (its project, its owner): each task is in
    # one group, so the groups' task counts add up to the page's.
    per_task: bool


# Period presets -> how many of the reader's calendar days to include, today
# counted (None = all time). The key is what the route accepts as ?period=...
# and what the selector renders. A period starts at a local midnight, so "7
# days" is seven whole days in the chart and the daily table, never a partial
# first one.
PERIODS: dict[str, Optional[int]] = {
    "today": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "all": None,
}
PERIOD_LABELS: dict[str, str] = {
    "today": "Today",
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
    "all": "All time",
}
DEFAULT_PERIOD = "7d"

# The daily figures are summed per quarter of an hour of UTC, then per the
# reader's day in Python. Every zone's offset from UTC is a whole number of
# quarters (Nepal's +05:45 too), so no quarter straddles a local midnight.
_QUARTER_SECONDS = 900
_QUARTER = (
    cast(func.floor(extract("epoch", TelemetryEvent.created_at)), BigInteger)
    // _QUARTER_SECONDS
)

_TOKENS = TelemetryEvent.input_tokens + TelemetryEvent.output_tokens

# What the breakdowns split the completions by. The completions are summed per
# combination of these that occurs, and each breakdown adds up those sums.
_DIMENSIONS = (
    TelemetryEvent.model_id,
    TelemetryEvent.mode,
    TelemetryEvent.provider,
    TelemetryEvent.completion_kind,
    TelemetryEvent.client_kind,
)

# Rows of a breakdown are ordered by their first event, so names that tie
# keep the order in which they first occurred.
_FIRST = func.min(TelemetryEvent.created_at).label("first_at")


def period_start(
    period: str, now: Optional[datetime] = None, zone: ZoneInfo = UTC
) -> Optional[datetime]:
    """Resolve a period key to an inclusive UTC lower bound, or None for all-time.

    The bound is the reader's local midnight (``zone``, utils/clientzone) that
    many days back, today included.
    """
    days = PERIODS.get(period, PERIODS[DEFAULT_PERIOD])
    if days is None:
        return None
    return day_start_utc(today(zone, now) - timedelta(days=days - 1), zone)


def _sum(column) -> ColumnElement:
    """SUM of a whole-number column, as one: Postgres sums BIGINT into NUMERIC."""
    return cast(func.sum(column), BigInteger)


def _completions(
    user_id: str,
    organization_id: Optional[str],
    start: Optional[datetime],
    client: Optional[str],
) -> Select:
    """The period's LLM Completion events, as a SELECT with no columns yet.

    The reader's own events, or with ``organization_id`` the events of that
    organization's tasks. Joined for a group's key and name: the event's task,
    its project (named only when the user may see it: an organization they
    left) and, in an organization, the task's owner.
    """
    if organization_id is None:
        # The (user_id, event_type, created_at) index serves the filter and
        # the range. The owner is part of the join, so an event naming another
        # user's task id has no project.
        stmt = (
            select()
            .select_from(TelemetryEvent)
            .outerjoin(
                Task, and_(Task.id == TelemetryEvent.task_id, Task.user_id == user_id)
            )
            .where(TelemetryEvent.user_id == user_id)
        )
    else:
        # Only the task owner's events count: anyone else's naming the task id
        # is not the organization's. IS NOT DISTINCT FROM means "=" here (a
        # task always has an owner), but the planner does not equate the two
        # columns: with "=", Postgres probed a heavy user's events once per
        # task of a page narrowed to one group (18 s a statement on the
        # bench). The owner is joined on the event's user, which lets it read
        # each member's events from the user-led index instead.
        stmt = (
            select()
            .select_from(TelemetryEvent)
            .join(
                Task,
                and_(
                    Task.id == TelemetryEvent.task_id,
                    Task.user_id.is_not_distinct_from(TelemetryEvent.user_id),
                ),
            )
            .join(User, User.id == TelemetryEvent.user_id)
            .where(Task.organization_id == organization_id)
        )
    stmt = stmt.outerjoin(
        Project, and_(Project.id == Task.project_id, visible_to(user_id))
    ).where(TelemetryEvent.event_type == LLM_COMPLETION_EVENT)
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if client is not None:
        stmt = stmt.where(TelemetryEvent.client_kind == client)
    return stmt


async def _embeddings(
    db: AsyncSession,
    user_id: str,
    start: Optional[datetime],
    client: Optional[str],
) -> dict:
    """Tokens spent on code-index embeddings in the period, by source.

    Reported apart from the completion totals rather than inside them. An index
    of a repository is one number with no output tokens and no price, and it is
    large enough to hide everything it sits next to; the question it answers
    ("what is indexing costing me?") is also a different question.
    """
    stmt = select(
        TelemetryEvent.embedding_source,
        _sum(TelemetryEvent.input_tokens).label("tokens"),
        func.count().label("calls"),
        _FIRST,
    ).where(
        TelemetryEvent.user_id == user_id,
        TelemetryEvent.event_type == EMBEDDING_EVENT,
    )
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if client is not None:
        stmt = stmt.where(TelemetryEvent.client_kind == client)
    stmt = stmt.group_by(TelemetryEvent.embedding_source).order_by(
        _FIRST, TelemetryEvent.embedding_source
    )
    return _embedding_totals((await db.execute(stmt)).all())


def _embedding_totals(rows: Sequence[Row]) -> dict:
    """The indexing figures from the embeddings summed per source."""
    by_source: dict[str, dict] = {}
    for row in rows:
        source = row.embedding_source or "unknown"
        slot = by_source.setdefault(source, {"name": source, "tokens": 0, "count": 0})
        slot["tokens"] += row.tokens
        slot["count"] += row.calls

    sources = sorted(by_source.values(), key=lambda s: -s["tokens"])
    for row in sources:
        row["tokens_fmt"] = fmt_tokens(row["tokens"])

    total = sum(s["tokens"] for s in sources)
    calls = sum(s["count"] for s in sources)
    return {
        "tokens": total,
        "tokens_fmt": fmt_tokens(total),
        "calls": calls,
        "by_source": sources,
        "has_data": calls > 0,
    }


async def _by_day(db: AsyncSession, completions: Select, zone: ZoneInfo) -> list:
    """Chronological {day, tokens, cost} of the reader's calendar days."""
    stmt = (
        completions.add_columns(
            _QUARTER.label("quarter"),
            _sum(_TOKENS).label("tokens"),
            func.sum(TelemetryEvent.cost).label("cost"),
        )
        .group_by("quarter")
        .order_by("quarter")
    )
    by_day: dict[str, dict] = {}
    for row in (await db.execute(stmt)).all():
        start = datetime.fromtimestamp(row.quarter * _QUARTER_SECONDS, timezone.utc)
        day = local_day(start, zone).isoformat()
        slot = by_day.setdefault(day, {"day": day, "tokens": 0, "cost": 0.0})
        slot["tokens"] += row.tokens
        slot["cost"] += row.cost
    return list(by_day.values())


async def _groups(
    db: AsyncSession, completions: Select, group_by: GroupBy, total_cost: float
) -> list[dict]:
    """{key, name, tokens, tokens_fmt, cost, share, count, tasks} per group,
    the costliest first."""
    stmt = (
        completions.add_columns(
            group_by.key.label("group_key"),
            group_by.name.label("group_name"),
            _sum(_TOKENS).label("tokens"),
            func.sum(TelemetryEvent.cost).label("cost"),
            func.count().label("completions"),
            func.count(distinct(TelemetryEvent.task_id)).label("tasks"),
            _FIRST,
        )
        .group_by("group_key", "group_name")
        .order_by(_FIRST, "group_key")
    )
    groups = [
        {
            "key": row.group_key,
            "name": row.group_name,
            "tokens": row.tokens,
            "tokens_fmt": fmt_tokens(row.tokens),
            "cost": row.cost,
            # Percent of the page's cost; None when nothing cost anything.
            "share": round(100 * row.cost / total_cost) if total_cost else None,
            "count": row.completions,
            "tasks": row.tasks,
        }
        for row in (await db.execute(stmt)).all()
    ]
    return sorted(groups, key=lambda g: (-g["cost"], -g["tokens"]))


async def compute_user_metrics(
    db: AsyncSession,
    user_id: str,
    period: str = DEFAULT_PERIOD,
    now: Optional[datetime] = None,
    client: Optional[str] = None,
    zone: ZoneInfo = UTC,
    group_by: Optional[GroupBy] = None,
    narrow=None,
    organization_id: Optional[str] = None,
) -> dict:
    """Aggregate the user's LLM-usage metrics for the given period.

    With ``organization_id`` the figures are that organization's instead: every
    completion of its tasks, whoever ran them, and no indexing (it belongs to
    no task). The caller has checked that the user administers it.

    ``client`` ("vscode" or "cli", services/client_kind) keeps only the events
    that client sent; None counts both. ``zone`` is the reader's: the period
    starts at their local midnight and ``by_day`` holds their calendar days.
    ``group_by`` sums the events per group into ``groups``; ``narrow`` (a
    condition on the events) keeps the events of one group, so every figure is
    the group's.

    Returns a JSON-serializable dict:
      - period, period_label
      - totals: input/output/cache_read/cache_write tokens, total_tokens, cost,
        completions
      - duration_ms / duration (the measured request durations, summed),
        task_count (distinct taskIds)
      - by_model / by_mode / by_provider: lists of {name, tokens, tokens_fmt,
        cost, count}, sorted desc by tokens
      - by_client: the same, with a ``label`` ("VS Code", "CLI")
      - by_day: chronological list of {day, tokens, cost}
      - groups: list of {key, name, tokens, tokens_fmt, cost, share, count,
        tasks}, sorted desc by cost; empty without ``group_by``
      - has_data
    """
    if period not in PERIODS:
        period = DEFAULT_PERIOD
    start = period_start(period, now, zone)
    completions = _completions(user_id, organization_id, start, client)
    if narrow is not None:
        completions = completions.where(narrow)

    combinations = (
        await db.execute(
            completions.add_columns(
                *_DIMENSIONS,
                _sum(TelemetryEvent.input_tokens).label("input"),
                _sum(TelemetryEvent.output_tokens).label("output"),
                _sum(TelemetryEvent.cache_read_tokens).label("cache_read"),
                _sum(TelemetryEvent.cache_write_tokens).label("cache_write"),
                func.sum(TelemetryEvent.cost).label("cost"),
                func.count().label("completions"),
                # Completions whose provider could not say what they cost.
                # Counted rather than silently added in as zero, so "12 calls
                # we have no figures for" reads as what it is instead of as
                # twelve free calls.
                func.count()
                .filter(TelemetryEvent.usage_reported.is_(False))
                .label("unreported"),
                # Summed from the completions that measured their request.
                _sum(TelemetryEvent.duration_ms).label("duration_ms"),
                _FIRST,
            )
            .group_by(*_DIMENSIONS)
            .order_by(_FIRST, *_DIMENSIONS)
        )
    ).all()

    totals = {
        "input": 0,
        "output": 0,
        "cache_read": 0,
        "cache_write": 0,
        "cost": 0.0,
        "completions": 0,
    }
    by_model: dict[str, dict] = {}
    by_mode: dict[str, dict] = {}
    by_provider: dict[str, dict] = {}
    by_kind: dict[str, dict] = {}
    by_client: dict[str, dict] = {}
    unreported = 0
    duration_ms = 0

    def _bucket(store: dict, name: str, row: Row) -> None:
        slot = store.setdefault(
            name, {"name": name, "tokens": 0, "cost": 0.0, "count": 0}
        )
        slot["tokens"] += row.input + row.output
        slot["cost"] += row.cost
        slot["count"] += row.completions

    for row in combinations:
        totals["input"] += row.input
        totals["output"] += row.output
        totals["cache_read"] += row.cache_read
        totals["cache_write"] += row.cache_write
        totals["cost"] += row.cost
        totals["completions"] += row.completions
        unreported += row.unreported
        duration_ms += row.duration_ms

        _bucket(by_model, row.model_id or "unknown", row)
        _bucket(by_mode, row.mode or "unknown", row)
        _bucket(by_provider, row.provider or "unknown", row)
        _bucket(by_kind, row.completion_kind, row)
        _bucket(by_client, row.client_kind, row)

    def _sorted(store: dict) -> list[dict]:
        items = sorted(store.values(), key=lambda s: s["tokens"], reverse=True)
        for s in items:
            s["tokens_fmt"] = fmt_tokens(s["tokens"])
        return items

    kinds = _sorted(by_kind)
    for row in kinds:
        row["label"] = KIND_LABELS.get(row["name"], row["name"])
    clients = _sorted(by_client)
    for row in clients:
        row["label"] = CLIENT_LABELS.get(row["name"], row["name"])

    total_tokens = totals["input"] + totals["output"]
    groups = (
        await _groups(db, completions, group_by, totals["cost"])
        if group_by is not None
        else []
    )
    if group_by is not None and group_by.per_task:
        task_count = sum(g["tasks"] for g in groups)
    else:
        task_count = await db.scalar(
            completions.add_columns(func.count(distinct(TelemetryEvent.task_id)))
        )
    # Indexing belongs to no task, so it is in no group and no organization.
    if narrow is not None or organization_id:
        embeddings = _embedding_totals([])
    else:
        embeddings = await _embeddings(db, user_id, start, client)

    return {
        "period": period,
        "period_label": PERIOD_LABELS.get(period, period),
        "totals": {
            **totals,
            "total_tokens": total_tokens,
            "total_tokens_fmt": fmt_tokens(total_tokens),
        },
        "duration_ms": duration_ms,
        "duration": fmt_duration(duration_ms),
        "task_count": task_count,
        "by_model": _sorted(by_model),
        "by_mode": _sorted(by_mode),
        "by_provider": _sorted(by_provider),
        "by_kind": kinds,
        "by_client": clients,
        "unreported": unreported,
        "embeddings": embeddings,
        "by_day": await _by_day(db, completions, zone),
        "groups": groups,
        "has_data": totals["completions"] > 0,
    }
