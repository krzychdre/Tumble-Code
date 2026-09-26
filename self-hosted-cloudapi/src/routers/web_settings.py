"""Retention settings (/app/settings): the policy form, its preview and "Run now"."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.models.retention import (
    SUGGESTED_MAX_AGE_DAYS,
    SUGGESTED_MAX_TASKS,
    SUGGESTED_TELEMETRY_MAX_AGE_DAYS,
)
from src.services.retention_service import apply_sweep, get_policy, plan_sweep, read_policy
from src.web.presenters.settings import _plan_view
from src.web.templating import templates

router = APIRouter(tags=["web"])


@router.get("/app/settings", response_class=HTMLResponse)
async def settings_page(
    request: Request,
    ran: str = Query(""),
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Retention settings, with a preview of exactly what a sweep would remove.

    The preview is computed by the same function the sweep acts on, so what is
    shown here and what would be deleted cannot drift apart. It renders whether
    or not retention is switched on - before you arm it is the one moment the
    preview is genuinely worth reading.
    """
    # read_policy, not get_policy: a GET must not write, so a user who has
    # never saved a policy sees the unsaved default instead of getting a row.
    policy = await read_policy(db, user["user_id"])
    plan = await plan_sweep(db, user["user_id"], policy)

    return templates.TemplateResponse(
        request,
        "settings.html",
        {
            "user": user,
            "nav_active": "settings",
            "policy": policy,
            "plan": _plan_view(plan),
            "suggest": {
                "age": SUGGESTED_MAX_AGE_DAYS,
                "tasks": SUGGESTED_MAX_TASKS,
                "telemetry": SUGGESTED_TELEMETRY_MAX_AGE_DAYS,
            },
            "ran": ran,
        },
    )


@router.post("/app/settings")
async def save_settings(
    request: Request,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the retention policy. Saving never deletes anything.

    Arming a policy and running it are deliberately separate actions: switching
    retention on should not silently remove hundreds of conversations in the
    same click that turned it on. Deleting happens on "Run now", or on the
    scheduled sweep.
    """
    form = await request.form()
    policy = await get_policy(db, user["user_id"])

    policy.enabled = form.get("enabled") == "1"
    policy.keep_shared = form.get("keep_shared") == "1"
    policy.purge_telemetry = form.get("purge_telemetry") == "1"
    policy.max_age_days = _positive_int(form.get("max_age_days"))
    policy.max_tasks = _positive_int(form.get("max_tasks"))
    policy.telemetry_max_age_days = _positive_int(form.get("telemetry_max_age_days"))

    await db.commit()
    return RedirectResponse(url="/app/settings", status_code=303)


@router.post("/app/settings/run")
async def run_retention_now(
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply the saved policy immediately.

    Runs regardless of the ``enabled`` switch: the button is an explicit
    instruction, and the switch only governs the scheduled sweep.
    """
    policy = await get_policy(db, user["user_id"])
    plan = await apply_sweep(db, user["user_id"], policy)
    await db.commit()
    return RedirectResponse(url=f"/app/settings?ran={plan.task_count}", status_code=303)


def _positive_int(value) -> Optional[int]:
    """Parse a form field to a positive int, or None to mean "rule disabled".

    Anything unparseable is treated as "off" rather than as zero: a zero limit
    would select every task the user owns, which is the opposite of what a
    fumbled entry should do.
    """
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None
