"""How a user's runs went over a period, in aggregate (the metrics page panel)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.task import Task
from src.services.metrics_service import period_start
from src.services.session_quality import (
    GRADE_CLEAN,
    GRADE_FRICTION,
    GRADE_LABELS,
    GRADE_UNFINISHED,
    quality_of,
)
from src.services.task_summary import DEFAULT_TITLE

# The columns quality_overview reads: the row's identity for the list, and
# the stored counts quality_of() grades.
_QUALITY_COLUMNS = (
    Task.id,
    Task.title,
    Task.q_requests,
    Task.q_errors,
    Task.q_retries,
    Task.q_interventions,
    Task.q_completion_replies,
    Task.q_condense,
    Task.q_tools,
    Task.q_tool_paths,
    Task.q_distinct_tool_paths,
    Task.q_completed,
)


async def quality_overview(db: AsyncSession, user_id: str, period: str) -> dict:
    """How the user's runs went over the period, in aggregate.

    Reads the stored per-task counts, so this is one query over `tasks` rather
    than a walk of any conversation. Subtasks are excluded: a run and the
    subtasks it delegated to would otherwise each be graded, counting one piece
    of work several times.

    The period bound is on ``updated_at`` (when the task was last written),
    which is the only time the task row itself carries.
    """
    filters = [Task.user_id == user_id, Task.parent_task_id.is_(None)]
    start = period_start(period)
    if start is not None:
        filters.append(Task.updated_at >= start)

    # Only what quality_of() and the "roughest" list read, not the whole row
    # (prompt excerpt, workspace path, token totals, models...).
    result = await db.execute(select(*_QUALITY_COLUMNS).where(*filters))
    tasks = result.all()
    if not tasks:
        return {"has_data": False}

    grades = {GRADE_CLEAN: 0, GRADE_FRICTION: 0, GRADE_UNFINISHED: 0}
    totals = {
        "interventions": 0,
        "completion_replies": 0,
        "errors": 0,
        "retries": 0,
        "condense": 0,
        "repeated_work": 0,
        "requests": 0,
    }
    ranked = []
    for task in tasks:
        q = quality_of(task)
        grades[q.grade] += 1
        for key in totals:
            totals[key] += getattr(q, key)
        if q.friction_events:
            ranked.append(
                {
                    "id": task.id,
                    "title": task.title or DEFAULT_TITLE,
                    "friction": q.friction_events,
                    "reasons": "; ".join(q.reasons()),
                }
            )
    ranked.sort(key=lambda r: r["friction"], reverse=True)

    total = len(tasks)
    return {
        "has_data": True,
        "total": total,
        "grades": [
            {
                "key": key,
                "label": GRADE_LABELS[key],
                "count": grades[key],
                "share": round(100 * grades[key] / total),
            }
            for key in (GRADE_CLEAN, GRADE_FRICTION, GRADE_UNFINISHED)
        ],
        "totals": totals,
        # Enough to act on, not a second full list.
        "roughest": ranked[:8],
    }
