"""What the dataset page shows: how much is recorded, how much of it is clean.

Read from the indexed columns only (never a payload): one grouped query per
table. "Clean" uses the issues stored at ingest (and refreshed by the outcome);
the export can still drop an exchange the stored issues call clean, when the
task shows a later tool failure or a broken chain (services/exchange_quality,
services/exchange_reconstruction).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.llm_exchange import LlmBlob, LlmExchange
from src.models.project import Project, ProjectBinding
from src.models.task import Task
from src.services.exchange_quality import ISSUE_LABELS, is_clean, split_issues
from src.services.metrics_service import period_start
from src.services.projects import exchange_binding
from src.utils.clientzone import UTC
from src.utils.pagination import paginate

TASKS_PAGE = 25


def _scope(user_id: str, period: str, client: Optional[str], zone: ZoneInfo) -> list:
    """The user's exchanges in ``period`` (from the reader's local midnight),
    of ``client`` ("vscode" or "cli"; None: both)."""
    since = period_start(period, zone=zone)
    scope = [LlmExchange.user_id == user_id]
    if since is not None:
        scope.append(LlmExchange.occurred_at >= since)
    if client is not None:
        scope.append(LlmExchange.client_kind == client)
    return scope


async def dataset_overview(
    db: AsyncSession,
    user_id: str,
    period: str,
    client: Optional[str] = None,
    zone: ZoneInfo = UTC,
) -> dict:
    """The page's figures over ``period``; ``client`` ("vscode" or "cli") keeps
    what that client recorded, None both. The period starts at the reader's
    local midnight (``zone``)."""
    scope = _scope(user_id, period, client, zone)

    grouped = await db.execute(
        select(
            LlmExchange.model_id,
            LlmExchange.provider,
            LlmExchange.issues,
            func.count(),
            func.sum(LlmExchange.output_tokens),
            func.sum(cast(LlmExchange.has_wire, Integer)),
        )
        .where(*scope)
        .group_by(LlmExchange.model_id, LlmExchange.provider, LlmExchange.issues)
    )
    models: dict[tuple, dict] = defaultdict(
        lambda: {
            "exchanges": 0,
            "clean": 0,
            "strict": 0,
            "output_tokens": 0,
            "issues": Counter(),
        }
    )
    issues: Counter = Counter()
    totals = {"exchanges": 0, "clean": 0, "strict": 0, "wire": 0}
    for model_id, provider, stored, count, output_tokens, wire in grouped.all():
        found = split_issues(stored)
        row = models[(model_id or "-", provider or "-")]
        row["exchanges"] += count
        row["output_tokens"] += int(output_tokens or 0)
        clean, strict = is_clean(found), is_clean(found, strict=True)
        row["clean"] += count if clean else 0
        row["strict"] += count if strict else 0
        totals["exchanges"] += count
        totals["clean"] += count if clean else 0
        totals["strict"] += count if strict else 0
        totals["wire"] += int(wire or 0)
        for issue in found:
            row["issues"][issue] += count
            issues[issue] += count

    model_rows = []
    for (model_id, provider), row in sorted(
        models.items(), key=lambda item: -item[1]["exchanges"]
    ):
        top = row["issues"].most_common(1)
        model_rows.append(
            {
                "model": model_id,
                "provider": provider,
                "exchanges": row["exchanges"],
                "clean": row["clean"],
                "strict": row["strict"],
                "clean_pct": round(100 * row["clean"] / row["exchanges"])
                if row["exchanges"]
                else 0,
                "output_tokens": row["output_tokens"],
                "top_issue": ISSUE_LABELS.get(top[0][0], top[0][0]) if top else None,
                "top_issue_count": top[0][1] if top else 0,
            }
        )

    task_count = (
        await db.scalar(
            select(func.count(func.distinct(LlmExchange.task_id))).where(*scope)
        )
        or 0
    )
    project_rows = (
        await db.execute(
            select(
                Project.id,
                Project.name,
                func.count(),
                func.count(func.distinct(LlmExchange.task_id)),
            )
            .join(ProjectBinding, exchange_binding())
            .join(Project, Project.id == ProjectBinding.project_id)
            .where(*scope)
            .group_by(Project.id, Project.name)
            .order_by(func.count().desc())
        )
    ).all()

    return {
        "period": period,
        "client": client,
        "totals": {**totals, "tasks": int(task_count)},
        "models": model_rows,
        "issues": [
            {"key": key, "label": ISSUE_LABELS.get(key, key), "count": count}
            for key, count in issues.most_common()
        ],
        "projects": [
            {"id": project_id, "name": name, "exchanges": count, "tasks": tasks}
            for project_id, name, count, tasks in project_rows
        ],
    }


async def recorded_tasks(
    db: AsyncSession,
    user_id: str,
    period: str,
    client: Optional[str],
    page: int,
    zone: ZoneInfo = UTC,
) -> dict:
    """One page of the recorded tasks, latest recording first, each with its
    title when the task is synced too, and the pager's fields."""
    scope = _scope(user_id, period, client, zone)
    total = await db.scalar(
        select(func.count(func.distinct(LlmExchange.task_id))).where(*scope)
    )
    pager = paginate(total, page, TASKS_PAGE)
    rows = (
        await db.execute(
            select(
                LlmExchange.task_id,
                func.max(LlmExchange.occurred_at),
                func.count(),
                func.max(LlmExchange.model_id),
            )
            .where(*scope)
            .group_by(LlmExchange.task_id)
            .order_by(func.max(LlmExchange.occurred_at).desc(), LlmExchange.task_id)
            .limit(TASKS_PAGE)
            .offset(pager["offset"])
        )
    ).all()
    ids = [row[0] for row in rows]
    titles = dict(
        (
            await db.execute(
                select(Task.id, Task.title).where(
                    Task.id.in_(ids), Task.user_id == user_id
                )
            )
        ).all()
    )
    return {
        "rows": [
            {
                "task_id": task_id,
                "last": last,
                "exchanges": count,
                "model": model,
                "title": titles.get(task_id),
            }
            for task_id, last, count, model in rows
        ],
        "total": total,
        **pager,
    }


async def recording_count(db: AsyncSession, user_id: str) -> int:
    """Every exchange the user has recorded, any period, any client."""
    return await db.scalar(
        select(func.count())
        .select_from(LlmExchange)
        .where(LlmExchange.user_id == user_id)
    )


async def delete_recordings(
    db: AsyncSession, user_id: str, task_ids: Optional[list[str]] = None
) -> int:
    """Delete the user's exchanges and blobs (all, or of the given tasks). Returns the exchanges removed."""
    exchanges = delete(LlmExchange).where(LlmExchange.user_id == user_id)
    blobs = delete(LlmBlob).where(LlmBlob.user_id == user_id)
    if task_ids is not None:
        exchanges = exchanges.where(LlmExchange.task_id.in_(task_ids))
        blobs = blobs.where(LlmBlob.task_id.in_(task_ids))
    result = await db.execute(exchanges)
    await db.execute(blobs)
    return int(result.rowcount or 0)
