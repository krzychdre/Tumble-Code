"""The diagnostics page (/app/diagnostics): errors and feature usage."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.services.diagnostics_service import compute_user_diagnostics
from src.services.metrics_service import DEFAULT_PERIOD, PERIOD_LABELS
from src.web.templating import templates

router = APIRouter(tags=["web"])


@router.get("/app/diagnostics", response_class=HTMLResponse)
async def diagnostics_page(
    request: Request,
    period: str = DEFAULT_PERIOD,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Errors and feature usage for the logged-in user over the selected period.

    See services/diagnostics_service.py.
    """
    diagnostics = await compute_user_diagnostics(db, user["user_id"], period)
    periods = [
        {"key": key, "label": label, "active": key == diagnostics["period"]}
        for key, label in PERIOD_LABELS.items()
    ]
    return templates.TemplateResponse(
        request,
        "diagnostics.html",
        {
            "user": user,
            "nav_active": "diagnostics",
            "diagnostics": diagnostics,
            "periods": periods,
        },
    )
