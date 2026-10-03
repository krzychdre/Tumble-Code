"""The usage-metrics dashboard (/app/metrics)."""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.routers.web_page import WebPage, render_page, require_web_page
from src.services.metrics_service import (
    DEFAULT_PERIOD,
    PERIOD_LABELS,
    compute_user_metrics,
)
from src.services.quality_overview import quality_overview
from src.web.presenters.charts import metrics_charts

router = APIRouter(tags=["web"])


@router.get("/app/metrics", response_class=HTMLResponse)
async def metrics_page(
    request: Request,
    period: str = DEFAULT_PERIOD,
    # The daily table's page. Absent on a plain visit; present only when the
    # reader used the table's pager, which is also when the table opens.
    day_page: int | None = Query(None),
    web: WebPage = Depends(require_web_page),
):
    """Usage-metrics dashboard for the logged-in user.

    Aggregates LLM Completion telemetry (tokens / cost / duration / models /
    modes) over the selected period. See services/metrics_service.py.
    """
    db: AsyncSession = web["db"]
    user_id = web["user"]["user_id"]
    metrics = await compute_user_metrics(db, user_id, period)
    periods = [
        {"key": key, "label": label, "active": key == metrics["period"]}
        for key, label in PERIOD_LABELS.items()
    ]
    quality = await quality_overview(db, user_id, period)
    return render_page(
        request,
        web,
        "metrics.html",
        "metrics",
        metrics=metrics,
        quality=quality,
        periods=periods,
        # Server-rendered SVG geometry (web/presenters/charts.py).
        charts=metrics_charts(metrics, day_page or 1),
        day_table_open=day_page is not None,
    )
