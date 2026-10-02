"""Error reports router: POST /api/error-reports.

The extension sends one report per problem while the user is signed in to
this cloud (same Bearer token as POST /api/events). See
schemas/error_report.py for the contract and services/error_report_service.py
for how a report is stored.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.database import get_db
from src.dependencies import get_current_user
from src.routers.events import capped_request
from src.schemas.error_report import ErrorReportRequest
from src.services.error_report_service import record_error_report

router = APIRouter(prefix="/api", tags=["events"])

# Largest report accepted, in bytes. The extension caps every text it sends
# (8000 characters for a message, a short tail of the conversation), so a real
# report is tens of kilobytes; a megabyte leaves room without letting one
# request fill the table.
MAX_REPORT_BYTES = 1024 * 1024


@router.post("/error-reports")
async def record_error_report_endpoint(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store one error report; a report whose id is already stored is ignored.

    The body is read by hand rather than declared as a parameter, so a body
    above ``MAX_REPORT_BYTES`` is refused with 413 before it is read whole.
    The answer is the same for a new report and a duplicate.
    """
    if not settings.telemetry_enabled:
        # The deployment does not take telemetry; a report carries more of
        # the conversation than any event, so it is not taken either. Still
        # a success, or the extension would retry it.
        return {"success": True, "stored": False}

    body = await capped_request(request, MAX_REPORT_BYTES).body()
    try:
        report = ErrorReportRequest.model_validate_json(body)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False))

    await record_error_report(db, current_user["user_id"], current_user.get("org_id"), report)
    return {"success": True}
