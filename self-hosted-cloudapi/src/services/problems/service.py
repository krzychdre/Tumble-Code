"""The problem report (/app/diagnostics) as one entry point: the user's
problems over a period, narrowed by filters, and one report's drill-down.

The stages live beside this module: ``collect`` (the three sources into
``Occurrence``), ``filters`` (one query-string state), ``aggregate``
(signature groups and the page's figures), ``views`` (a group's row, a
report's drill-down). Grouping runs in a worker thread, like the metrics
page.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.error_report import ErrorReport
from src.services.metrics_service import DEFAULT_PERIOD, PERIODS, period_start
from src.services.problems.aggregate import aggregate_problems
from src.services.problems.collect import _request_counts, collect_occurrences
from src.services.problems.filters import ProblemFilter
from src.services.problems.views import report_view
from src.utils.clientzone import UTC


async def compute_user_problems(
    db: AsyncSession,
    user_id: str,
    period: str = DEFAULT_PERIOD,
    now: Optional[datetime] = None,
    filters: Optional[ProblemFilter] = None,
    key: Optional[str] = None,
    zone: ZoneInfo = UTC,
) -> dict:
    """The user's problem report over ``period``, narrowed by ``filters``.

    ``filters.period``, when given, wins over ``period``; ``key`` narrows it
    to one group (see ``aggregate_problems``). ``zone`` is the reader's: the
    period starts at their local midnight.
    """
    if filters is not None:
        period = filters.period
    if period not in PERIODS:
        period = DEFAULT_PERIOD
    filters = replace(filters, period=period) if filters is not None else ProblemFilter(period=period)
    start = period_start(period, now, zone)
    occurrences, cutoff = await collect_occurrences(db, user_id, start)
    requests = await _request_counts(db, user_id, start, filters.client)
    return await anyio.to_thread.run_sync(aggregate_problems, occurrences, requests, period, cutoff, filters, key, zone
    )


async def load_report(db: AsyncSession, user_id: str, report_id: str, zone: ZoneInfo = UTC) -> Optional[dict]:
    """The drill-down of one report, or None unless ``user_id`` owns it."""
    row = await db.scalar(
        select(ErrorReport).where(ErrorReport.id == report_id, ErrorReport.user_id == user_id)
    )
    return report_view(row, zone) if row is not None else None
