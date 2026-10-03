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

from src.routers.web_page import (
    WebPage,
    not_found_page,
    render_page,
    require_web_page,
)
from src.services.diagnostics_service import (
    ProblemFilter,
    compute_user_problems,
    load_report,
)
from src.services.problem_brief import problem_brief_markdown
from src.web.presenters.problem_view import ProblemView

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
    web: WebPage = Depends(require_web_page),
):
    """The logged-in user's problems over the selected period, filtered, grouped and classified."""
    problems = await compute_user_problems(
        web["db"], web["user"]["user_id"], filters=filters
    )
    return render_page(
        request,
        web,
        "diagnostics.html",
        "diagnostics",
        problems=problems,
        filters=filters,
        view=ProblemView(filters),
    )


@router.get("/app/diagnostics/report.md", response_class=PlainTextResponse)
async def diagnostics_markdown(
    filters: ProblemFilter = Depends(problem_filter),
    web: WebPage = Depends(require_web_page),
):
    """The agent brief of every problem the filters let through, as a file."""
    text = await problem_brief_markdown(web["db"], web["user"]["user_id"], filters)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _markdown(text, f"tumble-problem-report-{filters.period}-{stamp}.md")


@router.get(
    "/app/diagnostics/problems/{key}/brief.md", response_class=PlainTextResponse
)
async def diagnostics_problem_brief(
    key: str,
    request: Request,
    filters: ProblemFilter = Depends(problem_filter),
    web: WebPage = Depends(require_web_page),
):
    """The agent brief of one problem group. Its owner only."""
    text = (
        await problem_brief_markdown(
            web["db"], web["user"]["user_id"], filters, key=key
        )
        if _GROUP_KEY.match(key)
        else None
    )
    if text is None:
        return not_found_page(
            request,
            web["user"],
            "Problem not found",
            "This problem does not exist in the chosen period, or you don't have access to it.",
            back_href="/app/diagnostics",
            back_label="Back to the problem report",
        )
    return _markdown(text, f"tumble-problem-{key}.md")


@router.get("/app/diagnostics/reports/{report_id}", response_class=HTMLResponse)
async def diagnostics_report(
    report_id: str,
    request: Request,
    web: WebPage = Depends(require_web_page),
):
    """One error report in full: facts, request, response. Its owner only."""
    report = await load_report(web["db"], web["user"]["user_id"], report_id)
    if report is None:
        return not_found_page(
            request,
            web["user"],
            "Report not found",
            "This report does not exist, or you don't have access to it.",
            back_href="/app/diagnostics",
            back_label="Back to the problem report",
        )
    return render_page(
        request, web, "diagnostics_report.html", "diagnostics", report=report
    )
