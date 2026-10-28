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

``telemetry_events.properties`` is stored as a JSON *string* (TEXT), and the test
suite runs on SQLite (no jsonb operators), so we load the rows and aggregate in
Python. The volume is modest (one self-hosted user), so this is cheap and
dialect-portable. Event names, kinds, labels and the payload decoding come from
``services/telemetry_vocab``.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Optional, Sequence
from zoneinfo import ZoneInfo

import anyio
from sqlalchemy import Row, and_, select
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
    completion_kind,
    iter_event_props,
    parse_event_props,
)
from src.utils.clientzone import UTC, day_start_utc, local_day, today
from src.utils.format import fmt_duration, fmt_tokens, num as _num

logger = logging.getLogger(__name__)

# (key, name) of the group an event belongs to, from its payload and its row
# of the completions query (web/presenters/metrics_view.GROUPINGS).
GroupKey = Callable[[dict, Row], tuple[str, str]]

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


async def _embedding_payloads(
    db: AsyncSession,
    user_id: str,
    start: Optional[datetime],
    client: Optional[str] = None,
) -> list:
    """The ``properties`` blobs of the user's embedding events in the period."""
    stmt = select(TelemetryEvent.properties).where(
        TelemetryEvent.user_id == user_id,
        TelemetryEvent.event_type == EMBEDDING_EVENT,
    )
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if client is not None:
        stmt = stmt.where(TelemetryEvent.client_kind == client)
    return [payload for (payload,) in (await db.execute(stmt)).all()]


def _embedding_totals(payloads: Iterable) -> dict:
    """Tokens spent on code-index embeddings in the period, by source.

    Reported apart from the completion totals rather than inside them. An index
    of a repository is one number with no output tokens and no price, and it is
    large enough to hide everything it sits next to; the question it answers
    ("what is indexing costing me?") is also a different question.
    """
    total = 0
    calls = 0
    by_source: dict[str, dict] = {}
    for props in iter_event_props(payloads):
        tokens = int(_num(props.get("promptTokens")))
        total += tokens
        calls += 1
        source = str(props.get("source") or "unknown")
        slot = by_source.setdefault(source, {"name": source, "tokens": 0, "count": 0})
        slot["tokens"] += tokens
        slot["count"] += 1

    sources = sorted(by_source.values(), key=lambda s: -s["tokens"])
    for row in sources:
        row["tokens_fmt"] = fmt_tokens(row["tokens"])

    return {
        "tokens": total,
        "tokens_fmt": fmt_tokens(total),
        "calls": calls,
        "by_source": sources,
        "has_data": calls > 0,
    }


async def compute_user_metrics(
    db: AsyncSession,
    user_id: str,
    period: str = DEFAULT_PERIOD,
    now: Optional[datetime] = None,
    client: Optional[str] = None,
    zone: ZoneInfo = UTC,
    group_key: Optional[GroupKey] = None,
    only: str = "",
    organization_id: Optional[str] = None,
) -> dict:
    """Aggregate the user's LLM-usage metrics for the given period.

    With ``organization_id`` the figures are that organization's instead: every
    completion of its tasks, whoever ran them, and no indexing (it belongs to
    no task). The caller has checked that the user administers it.

    ``client`` ("vscode" or "cli", services/client_kind) keeps only the events
    that client sent; None counts both. ``zone`` is the reader's: the period
    starts at their local midnight and ``by_day`` holds their calendar days.
    ``group_key`` sums the events per group into ``groups``; ``only`` keeps the
    events of that one group, so every figure is the group's.

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
        tasks}, sorted desc by cost; empty without ``group_key``
      - has_data
    """
    if period not in PERIODS:
        period = DEFAULT_PERIOD
    start = period_start(period, now, zone)

    # Only the columns the aggregation reads, as plain rows: no ORM entity
    # per event (identity map, attribute instrumentation). The project is the
    # event's task's, joined on the primary keys; its name only when the user
    # may see it (an organization they left), as on the task list.
    columns = [
        TelemetryEvent.properties,
        TelemetryEvent.created_at,
        TelemetryEvent.client_kind,
        Task.project_id,
        Project.name.label("project_name"),
    ]
    if organization_id is None:
        # The (user_id, event_type, created_at) index serves the filter, the
        # range and the ORDER BY; the client condition only drops rows that
        # index found. The owner is part of the join, so an event naming
        # another user's task id has no project.
        stmt = (
            select(*columns)
            .outerjoin(
                Task, and_(Task.id == TelemetryEvent.task_id, Task.user_id == user_id)
            )
            .where(TelemetryEvent.user_id == user_id)
        )
    else:
        # The organization's tasks are indexed (ix_tasks_organization_id), their
        # events by task id and by user. Only the task owner's events count:
        # anyone else's naming the task id is not the organization's. Who ran
        # it names the "By user" group.
        stmt = (
            select(
                *columns,
                TelemetryEvent.user_id,
                User.first_name,
                User.last_name,
                User.email,
            )
            .join(
                Task,
                and_(
                    Task.id == TelemetryEvent.task_id,
                    Task.user_id == TelemetryEvent.user_id,
                ),
            )
            .join(User, User.id == Task.user_id)
            .where(Task.organization_id == organization_id)
        )
    stmt = stmt.outerjoin(
        Project, and_(Project.id == Task.project_id, visible_to(user_id))
    ).where(TelemetryEvent.event_type == LLM_COMPLETION_EVENT)
    if start is not None:
        stmt = stmt.where(TelemetryEvent.created_at >= start)
    if client is not None:
        stmt = stmt.where(TelemetryEvent.client_kind == client)
    stmt = stmt.order_by(TelemetryEvent.created_at)

    rows = (await db.execute(stmt)).all()
    # Indexing belongs to no task, so it is in no group and no organization.
    embedding_payloads = (
        []
        if only or organization_id
        else await _embedding_payloads(db, user_id, start, client)
    )

    # The loop below is pure Python over every completion in the period (about
    # 58 ms for all time on the live deployment); in a worker thread it no
    # longer holds up every other request while it runs.
    return await anyio.to_thread.run_sync(
        aggregate_user_metrics,
        rows,
        embedding_payloads,
        period,
        now,
        zone,
        group_key,
        only,
    )


def aggregate_user_metrics(
    rows: Sequence[tuple],
    embedding_payloads: Sequence,
    period: str,
    now: Optional[datetime] = None,
    zone: ZoneInfo = UTC,
    group_key: Optional[GroupKey] = None,
    only: str = "",
) -> dict:
    """The metrics page's figures from the fetched rows; see compute_user_metrics.

    ``rows`` are the completions query's rows (``properties``, ``created_at``,
    ``client_kind``, ``project_id``, ``project_name`` and, in an organization,
    who ran the event) of the period's ``LLM Completion`` events, oldest first;
    ``embedding_payloads`` the ``properties`` of its embedding events. Pure: no
    database, no I/O.
    """
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
    by_day: dict[str, dict] = {}
    # Completions whose provider could not say what they cost. Counted rather
    # than silently added in as zero, so "12 calls we have no figures for" reads
    # as what it is instead of as twelve free calls.
    unreported = 0
    # Summed from the completions that measured their request (durationMs).
    duration_ms = 0
    task_ids: set[str] = set()
    groups: dict[str, dict] = {}
    # Rows of the shown group (all of them when the page is not narrowed).
    kept = 0

    def _bucket(store: dict, name: str, tokens: float, cost: float) -> None:
        slot = store.setdefault(
            name, {"name": name, "tokens": 0, "cost": 0.0, "count": 0}
        )
        slot["tokens"] += tokens
        slot["cost"] += cost
        slot["count"] += 1

    for row in rows:
        props = parse_event_props(row.properties)
        if group_key is not None:
            key, name = group_key(props or {}, row)
            if only and key != only:
                continue
        kept += 1
        if props is None:
            continue

        tin = _num(props.get("inputTokens"))
        tout = _num(props.get("outputTokens"))
        cread = _num(props.get("cacheReadTokens"))
        cwrite = _num(props.get("cacheWriteTokens"))
        cost = _num(props.get("cost"))
        tokens = tin + tout

        totals["input"] += tin
        totals["output"] += tout
        totals["cache_read"] += cread
        totals["cache_write"] += cwrite
        totals["cost"] += cost
        totals["completions"] += 1

        kind = completion_kind(props)
        if props.get("usageReported") is False:
            unreported += 1

        _bucket(by_model, str(props.get("modelId") or "unknown"), tokens, cost)
        _bucket(by_mode, str(props.get("mode") or "unknown"), tokens, cost)
        _bucket(by_provider, str(props.get("apiProvider") or "unknown"), tokens, cost)
        _bucket(by_kind, kind, tokens, cost)
        _bucket(by_client, row.client_kind or "unknown", tokens, cost)

        created = row.created_at or (now or datetime.now(timezone.utc))
        day = local_day(created, zone).isoformat()
        dslot = by_day.setdefault(day, {"day": day, "tokens": 0, "cost": 0.0})
        dslot["tokens"] += tokens
        dslot["cost"] += cost

        duration_ms += _num(props.get("durationMs"))
        task_id = props.get("taskId")
        if task_id:
            task_ids.add(task_id)

        if group_key is not None:
            gslot = groups.setdefault(
                key,
                {
                    "key": key,
                    "name": name,
                    "tokens": 0,
                    "cost": 0.0,
                    "count": 0,
                    "task_ids": set(),
                },
            )
            gslot["tokens"] += tokens
            gslot["cost"] += cost
            gslot["count"] += 1
            if task_id:
                gslot["task_ids"].add(task_id)

    def _sorted(store: dict) -> list[dict]:
        items = sorted(store.values(), key=lambda s: s["tokens"], reverse=True)
        for s in items:
            s["tokens_fmt"] = fmt_tokens(s["tokens"])
        return items

    models = _sorted(by_model)
    modes = _sorted(by_mode)
    providers = _sorted(by_provider)
    kinds = _sorted(by_kind)
    for row in kinds:
        row["label"] = KIND_LABELS.get(row["name"], row["name"])
    clients = _sorted(by_client)
    for row in clients:
        row["label"] = CLIENT_LABELS.get(row["name"], row["name"])
    days = sorted(by_day.values(), key=lambda d: d["day"])
    embeddings = _embedding_totals(embedding_payloads)

    total_tokens = totals["input"] + totals["output"]

    by_group = sorted(groups.values(), key=lambda g: (-g["cost"], -g["tokens"]))
    for row in by_group:
        row["tasks"] = len(row.pop("task_ids"))
        row["tokens_fmt"] = fmt_tokens(row["tokens"])
        # Percent of the page's cost; None when nothing cost anything.
        row["share"] = (
            round(100 * row["cost"] / totals["cost"]) if totals["cost"] else None
        )

    return {
        "period": period,
        "period_label": PERIOD_LABELS.get(period, period),
        "totals": {
            **{k: int(v) if k != "cost" else v for k, v in totals.items()},
            "total_tokens": int(total_tokens),
            "total_tokens_fmt": fmt_tokens(total_tokens),
        },
        "duration_ms": int(duration_ms),
        "duration": fmt_duration(duration_ms),
        "task_count": len(task_ids),
        "by_model": models,
        "by_mode": modes,
        "by_provider": providers,
        "by_kind": kinds,
        "by_client": clients,
        "unreported": unreported,
        "embeddings": embeddings,
        "by_day": days,
        "groups": by_group,
        "has_data": kept > 0,
    }
