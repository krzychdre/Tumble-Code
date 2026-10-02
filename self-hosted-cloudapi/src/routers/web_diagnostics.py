"""The problem report (/app/diagnostics): what goes wrong, whose fault, what to do.

Three views of services/diagnostics_service: the page, one report in full, and
the same report as Markdown to hand to a coding agent.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.services.diagnostics_service import compute_user_problems, load_report, problem_report_markdown
from src.services.metrics_service import DEFAULT_PERIOD, PERIOD_LABELS, PERIODS
from src.web.templating import templates

router = APIRouter(tags=["web"])


@router.get("/app/diagnostics", response_class=HTMLResponse)
async def diagnostics_page(
    request: Request,
    period: str = DEFAULT_PERIOD,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """The logged-in user's problems over the selected period, grouped and classified."""
    problems = await compute_user_problems(db, user["user_id"], period)
    periods = [
        {"key": key, "label": label, "active": key == problems["period"]}
        for key, label in PERIOD_LABELS.items()
    ]
    return templates.TemplateResponse(
        request,
        "diagnostics.html",
        {
            "user": user,
            "nav_active": "diagnostics",
            "problems": problems,
            "periods": periods,
        },
    )


@router.get("/app/diagnostics/report.md", response_class=PlainTextResponse)
async def diagnostics_markdown(
    period: str = DEFAULT_PERIOD,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """The problem report as Markdown, downloaded as a file."""
    if period not in PERIODS:
        period = DEFAULT_PERIOD
    text = await problem_report_markdown(db, user["user_id"], period)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return PlainTextResponse(
        text,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="tumble-problem-report-{period}-{stamp}.md"'},
    )


@router.get("/app/diagnostics/reports/{report_id}", response_class=HTMLResponse)
async def diagnostics_report(
    report_id: str,
    request: Request,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """One error report in full: facts, request, response. Its owner only."""
    report = await load_report(db, user["user_id"], report_id)
    if report is None:
        # The same 404 whether the id is unknown or someone else's.
        return templates.TemplateResponse(
            request,
            "not_found.html",
            {
                "user": user,
                "heading": "Report not found",
                "hint": "This report does not exist, or you don't have access to it.",
                "back_href": "/app/diagnostics",
                "back_label": "Back to the problem report",
            },
            status_code=404,
        )
    return templates.TemplateResponse(
        request,
        "diagnostics_report.html",
        {"user": user, "nav_active": "diagnostics", "report": report},
    )
