"""The usage-metrics dashboard (/app/metrics)."""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import cookie_should_be_secure
from src.routers.web_page import WebPage, render_page, require_web_page
from src.services.client_kind import CLIENT_LABELS, parse_client
from src.services.metrics_service import (
    DEFAULT_PERIOD,
    PERIOD_LABELS,
    PERIODS,
    compute_user_metrics,
)
from src.services.quality_overview import quality_overview
from src.web.presenters.charts import metrics_charts

router = APIRouter(tags=["web"])

# The period the reader last picked. A plain visit (the nav link carries no
# ?period=) opens on it instead of the default, until they pick another.
PERIOD_COOKIE = "tumble_metrics_period"
PERIOD_COOKIE_MAX_AGE = 365 * 24 * 3600


@router.get("/app/metrics", response_class=HTMLResponse)
async def metrics_page(
    request: Request,
    period: str | None = None,
    # "vscode" or "cli": only what that client sent. Absent (or unknown) means
    # both. Not remembered like the period: a plain visit shows everything.
    client: str | None = None,
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
    picked = period in PERIODS
    if not picked:
        remembered = request.cookies.get(PERIOD_COOKIE)
        period = remembered if remembered in PERIODS else DEFAULT_PERIOD
    client = parse_client(client)
    metrics = await compute_user_metrics(db, user_id, period, client=client)
    periods = [
        {"key": key, "label": label, "active": key == metrics["period"]}
        for key, label in PERIOD_LABELS.items()
    ]
    clients = [
        {"key": key, "label": label, "active": key == client}
        for key, label in [(None, "All clients"), *CLIENT_LABELS.items()]
    ]
    quality = await quality_overview(db, user_id, period, client)
    response = render_page(
        request,
        web,
        "metrics.html",
        "metrics",
        metrics=metrics,
        quality=quality,
        periods=periods,
        clients=clients,
        client=client,
        # Server-rendered SVG geometry (web/presenters/charts.py).
        charts=metrics_charts(metrics, day_page or 1),
        day_table_open=day_page is not None,
    )
    if picked:
        response.set_cookie(
            key=PERIOD_COOKIE,
            value=period,
            max_age=PERIOD_COOKIE_MAX_AGE,
            httponly=True,
            samesite="lax",
            secure=cookie_should_be_secure(request),
            path="/app/metrics",
        )
    return response
