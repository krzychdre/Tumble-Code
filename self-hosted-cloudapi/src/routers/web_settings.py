"""Retention settings (/app/settings): the policy form, its preview and "Run now"."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from src.routers.web_page import WebPage, render_page, require_web_page
from src.models.retention import (
    SUGGESTED_MAX_AGE_DAYS,
    SUGGESTED_MAX_TASKS,
    SUGGESTED_TELEMETRY_MAX_AGE_DAYS,
)
from src.services.retention_service import (
    apply_sweep,
    get_policy,
    plan_sweep,
    read_policy,
)
from src.web.presenters.settings import _plan_view

router = APIRouter(tags=["web"])


@router.get("/app/settings", response_class=HTMLResponse)
async def settings_page(
    request: Request,
    ran: str = Query(""),
    size: str = Query(""),
    web: WebPage = Depends(require_web_page),
):
    """Retention settings, with a preview of exactly what a sweep would remove.

    The preview is computed by the same function the sweep acts on, so what is
    shown here and what would be deleted cannot drift apart. It renders whether
    or not retention is switched on - before you arm it is the one moment the
    preview is genuinely worth reading.

    The counts are always shown; the approximate size only with ``?size=1``
    (the "Calculate" link on the page), because summing it reads every
    selected conversation and event and was most of this page's cost.
    """
    return await _settings_response(request, web, ran=ran, size=size)


async def _settings_response(
    request: Request,
    web: WebPage,
    *,
    ran: str = "",
    size: str = "",
    error: Optional[str] = None,
    status_code: int = 200,
) -> HTMLResponse:
    db = web["db"]
    # read_policy, not get_policy: a GET must not write, so a user who has
    # never saved a policy sees the unsaved default instead of getting a row.
    policy = await read_policy(db, web["user"]["user_id"])
    plan = await plan_sweep(
        db, web["user"]["user_id"], policy, measure_size=size == "1"
    )

    response = render_page(
        request,
        web,
        "settings.html",
        "settings",
        policy=policy,
        plan=_plan_view(plan),
        suggest={
            "age": SUGGESTED_MAX_AGE_DAYS,
            "tasks": SUGGESTED_MAX_TASKS,
            "telemetry": SUGGESTED_TELEMETRY_MAX_AGE_DAYS,
        },
        ran=ran,
        error=error,
    )
    response.status_code = status_code
    return response


@router.post("/app/settings")
async def save_settings(
    request: Request,
    web: WebPage = Depends(require_web_page),
):
    """Save the retention policy. Saving never deletes anything.

    Arming a policy and running it are deliberately separate actions: switching
    retention on should not silently remove hundreds of conversations in the
    same click that turned it on. Deleting happens on "Run now", or on the
    scheduled sweep.
    """
    form = await request.form()
    try:
        max_age_days = _positive_int(form.get("max_age_days"), MAX_DAYS, "days")
        max_tasks = _positive_int(form.get("max_tasks"), MAX_TASKS, "tasks")
        telemetry_max_age_days = _positive_int(
            form.get("telemetry_max_age_days"), MAX_DAYS, "days"
        )
    except OutOfRange as exc:
        # Nothing is saved: the page comes back with the policy as stored.
        return await _settings_response(request, web, error=str(exc), status_code=400)
    policy = await get_policy(web["db"], web["user"]["user_id"])
    policy.enabled = form.get("enabled") == "1"
    policy.keep_shared = form.get("keep_shared") == "1"
    policy.purge_telemetry = form.get("purge_telemetry") == "1"
    policy.max_age_days = max_age_days
    policy.max_tasks = max_tasks
    policy.telemetry_max_age_days = telemetry_max_age_days

    await web["db"].commit()
    return RedirectResponse(url="/app/settings", status_code=303)


@router.post("/app/settings/run")
async def run_retention_now(
    web: WebPage = Depends(require_web_page),
):
    """Apply the saved policy immediately.

    Runs regardless of the ``enabled`` switch: the button is an explicit
    instruction, and the switch only governs the scheduled sweep.
    """
    policy = await get_policy(web["db"], web["user"]["user_id"])
    plan = await apply_sweep(web["db"], web["user"]["user_id"], policy)
    await web["db"].commit()
    return RedirectResponse(url=f"/app/settings?ran={plan.task_count}", status_code=303)


# The form's own limits (settings.html), enforced here too: a larger number
# typed past the browser (or posted directly) was stored as is, and an age
# such as 100000000 days put the cutoff before year 1, so every later
# GET /app/settings and every sweep raised OverflowError.
MAX_DAYS = 3650
MAX_TASKS = 100000


class OutOfRange(ValueError):
    pass


def _positive_int(value, maximum: int, unit: str) -> Optional[int]:
    """Parse a form field to a positive int, or None to mean "rule disabled".

    Anything unparseable is treated as "off" rather than as zero: a zero limit
    would select every task the user owns, which is the opposite of what a
    fumbled entry should do. A number above ``maximum`` raises OutOfRange:
    silently switching the rule off, or capping it, would not be what was
    asked for either.
    """
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if number > maximum:
        raise OutOfRange(f"At most {maximum} {unit}; nothing was saved.")
    return number if number > 0 else None
