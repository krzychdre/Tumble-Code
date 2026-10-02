"""The problem report (/app/diagnostics): what goes wrong, whose fault, what to do.

Four views of services/diagnostics_service: the page (filtered and sorted by
its query string), one report in full, and the agent brief
(services/problem_brief) of the filtered report or of one problem group.
"""

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.services.diagnostics_service import ProblemFilter, compute_user_problems, load_report
from src.services.problem_brief import problem_brief_markdown
from src.web.presenters.problem_view import ProblemView
from src.web.templating import templates

router = APIRouter(tags=["web"])

# group_key: 12 hex digits of the signature's SHA-256.
_GROUP_KEY = re.compile(r"^[0-9a-f]{12}$")


def problem_filter(
    period: Optional[str] = None,
    class_: Optional[str] = Query(None, alias="class"),
    category: Optional[str] = None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    tool: Optional[str] = None,
    source: Optional[str] = None,
    q: Optional[str] = None,
    sort: Optional[str] = None,
) -> ProblemFilter:
    """The page's state from its query string. Plain strings, so nothing a
    link says can fail validation: ``ProblemFilter.parse`` drops what it does
    not know instead."""
    return ProblemFilter.parse(
        {
            "period": period,
            "class": class_,
            "category": category,
            "model": model,
            "provider": provider,
            "tool": tool,
            "source": source,
            "q": q,
            "sort": sort,
        }
    )


def _not_found(request: Request, user: WebUser, heading: str, hint: str):
    # The same 404 whether the thing is unknown or someone else's.
    return templates.TemplateResponse(
        request,
        "not_found.html",
        {
            "user": user,
            "heading": heading,
            "hint": hint,
            "back_href": "/app/diagnostics",
            "back_label": "Back to the problem report",
        },
        status_code=404,
    )


def _markdown(text: str, filename: str) -> PlainTextResponse:
    return PlainTextResponse(
        text,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/app/diagnostics", response_class=HTMLResponse)
async def diagnostics_page(
    request: Request,
    filters: ProblemFilter = Depends(problem_filter),
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """The logged-in user's problems over the selected period, filtered, grouped and classified."""
    problems = await compute_user_problems(db, user["user_id"], filters=filters)
    return templates.TemplateResponse(
        request,
        "diagnostics.html",
        {
            "user": user,
            "nav_active": "diagnostics",
            "problems": problems,
            "filters": filters,
            "view": ProblemView(filters),
        },
    )


@router.get("/app/diagnostics/report.md", response_class=PlainTextResponse)
async def diagnostics_markdown(
    filters: ProblemFilter = Depends(problem_filter),
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """The agent brief of every problem the filters let through, as a file."""
    text = await problem_brief_markdown(db, user["user_id"], filters)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _markdown(text, f"tumble-problem-report-{filters.period}-{stamp}.md")


@router.get("/app/diagnostics/problems/{key}/brief.md", response_class=PlainTextResponse)
async def diagnostics_problem_brief(
    key: str,
    request: Request,
    filters: ProblemFilter = Depends(problem_filter),
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """The agent brief of one problem group. Its owner only."""
    text = await problem_brief_markdown(db, user["user_id"], filters, key=key) if _GROUP_KEY.match(key) else None
    if text is None:
        return _not_found(
            request,
            user,
            "Problem not found",
            "This problem does not exist in the chosen period, or you don't have access to it.",
        )
    return _markdown(text, f"tumble-problem-{key}.md")


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
        return _not_found(request, user, "Report not found", "This report does not exist, or you don't have access to it.")
    return templates.TemplateResponse(
        request,
        "diagnostics_report.html",
        {"user": user, "nav_active": "diagnostics", "report": report},
    )
