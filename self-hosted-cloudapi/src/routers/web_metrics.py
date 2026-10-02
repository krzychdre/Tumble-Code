"""The usage-metrics dashboard (/app/metrics)."""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.services.metrics_service import DEFAULT_PERIOD, PERIOD_LABELS, compute_user_metrics
from src.services.quality_overview import quality_overview
from src.web.presenters.charts import metrics_charts
from src.web.templating import templates

router = APIRouter(tags=["web"])


@router.get("/app/metrics", response_class=HTMLResponse)
async def metrics_page(
    request: Request,
    period: str = DEFAULT_PERIOD,
    # The daily table's page. Absent on a plain visit; present only when the
    # reader used the table's pager, which is also when the table opens.
    day_page: int | None = Query(None),
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Usage-metrics dashboard for the logged-in user.

    Aggregates LLM Completion telemetry (tokens / cost / duration / models /
    modes) over the selected period. See services/metrics_service.py.
    """
    metrics = await compute_user_metrics(db, user["user_id"], period)
    periods = [
        {"key": key, "label": label, "active": key == metrics["period"]}
        for key, label in PERIOD_LABELS.items()
    ]
    quality = await quality_overview(db, user["user_id"], period)
    return templates.TemplateResponse(
        request,
        "metrics.html",
        {
            "user": user,
            "nav_active": "metrics",
            "metrics": metrics,
            "quality": quality,
            "periods": periods,
            # Server-rendered SVG geometry (web/presenters/charts.py).
            "charts": metrics_charts(metrics, day_page or 1),
            "day_table_open": day_page is not None,
        },
    )
