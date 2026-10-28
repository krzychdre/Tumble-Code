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
from src.web.presenters.metrics_view import (
    DEFAULT_GROUP,
    GROUP_OPTIONS,
    GROUP_ROWS,
    NO_GROUP,
    MetricsView,
)

router = APIRouter(tags=["web"])

# The period and the grouping the reader last picked. A plain visit (the nav
# link carries neither) opens on them instead of the defaults, until they pick
# others. The task list remembers its grouping too (routers/web_tasks).
PERIOD_COOKIE = "tumble_metrics_period"
GROUP_COOKIE = "tumble_metrics_group"
COOKIE_MAX_AGE = 365 * 24 * 3600


def _remembered(request: Request, cookie: str, value, allowed, default):
    """(the value to show, whether the request picked it)."""
    if value in allowed:
        return value, True
    remembered = request.cookies.get(cookie)
    return (remembered if remembered in allowed else default), False


def _remember(response, request: Request, cookie: str, value: str) -> None:
    response.set_cookie(
        key=cookie,
        value=value,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=cookie_should_be_secure(request),
        path="/app/metrics",
    )


@router.get("/app/metrics", response_class=HTMLResponse)
async def metrics_page(
    request: Request,
    period: str | None = None,
    # "vscode" or "cli": only what that client sent. Absent (or unknown) means
    # both. Not remembered like the period: a plain visit shows everything.
    client: str | None = None,
    # "project", "model" or "none" (web/presenters/metrics_view): the table of
    # groups. ``only`` narrows the whole page to one group.
    group: str | None = None,
    only: str | None = None,
    # The daily table's page. Absent on a plain visit; present only when the
    # reader used the table's pager, which is also when the table opens.
    day_page: int | None = Query(None),
    # "all": every group in the table, not the first GROUP_ROWS.
    groups: str | None = None,
    web: WebPage = Depends(require_web_page),
):
    """Usage-metrics dashboard for the logged-in user.

    Aggregates LLM Completion telemetry (tokens / cost / duration / models /
    modes) over the selected period. See services/metrics_service.py.
    """
    db: AsyncSession = web["db"]
    user_id = web["user"]["user_id"]
    period, period_picked = _remembered(
        request, PERIOD_COOKIE, period, PERIODS, DEFAULT_PERIOD
    )
    group, group_picked = _remembered(
        request, GROUP_COOKIE, group, [key for key, _ in GROUP_OPTIONS], DEFAULT_GROUP
    )
    view = MetricsView(
        period, parse_client(client), group, (only or "") if group != NO_GROUP else ""
    )
    grouping = view.grouping
    metrics = await compute_user_metrics(
        db,
        user_id,
        view.period,
        client=view.client,
        zone=web["zone"],
        group_key=grouping.event_key if grouping else None,
        only=view.only,
    )
    periods = [
        {"key": key, "label": label, "active": key == view.period}
        for key, label in PERIOD_LABELS.items()
    ]
    clients = [
        {"key": key, "label": label, "active": key == view.client}
        for key, label in [(None, "All clients"), *CLIENT_LABELS.items()]
    ]
    quality = await quality_overview(
        db,
        user_id,
        view.period,
        view.client,
        zone=web["zone"],
        narrow=view.tasks_condition(),
    )
    response = render_page(
        request,
        web,
        "metrics.html",
        "metrics",
        metrics=metrics,
        quality=quality,
        periods=periods,
        clients=clients,
        view=view,
        group_options=GROUP_OPTIONS,
        group_limit=GROUP_ROWS,
        all_groups=groups == "all",
        only_label=view.only_label(metrics["groups"]) if view.only else "",
        # Server-rendered SVG geometry (web/presenters/charts.py).
        charts=metrics_charts(metrics, day_page or 1),
        day_table_open=day_page is not None,
    )
    if period_picked:
        _remember(response, request, PERIOD_COOKIE, view.period)
    if group_picked:
        _remember(response, request, GROUP_COOKIE, view.group)
    return response
