"""Web task viewer router.

Server-rendered pages (Jinja2) for browsing shared tasks in a browser:
- GET /app                  task list for the logged-in user
- GET /app/tasks/{task_id}  read-only conversation view (owner only)
- GET /shared/{task_id}     public share-link target (anon if visibility=public)

Login/logout live in routers/browser.py (/app/login, /app/logout) because they
reuse the Authentik OAuth flow there. Conversation rendering is done client-side
by static/render.js from the embedded ClineMessage[] JSON.
"""

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.database import get_db
from src.auth.web_session import WebUser, get_web_user_optional
from src.models.task import Task, TaskMessage, TaskShare
from src.services.share_service import delete_shared_task

logger = logging.getLogger(__name__)

_WEB_DIR = Path(__file__).resolve().parent.parent / "web"
templates = Jinja2Templates(directory=str(_WEB_DIR / "templates"))


def _asset_version() -> str:
    """Cache-busting token: newest mtime across the static bundle.

    Appended as ``?v=<token>`` to CSS/JS URLs so a browser refetches the
    assets whenever they change instead of serving a stale cached copy
    (the page HTML is dynamic, but ``/static/*`` is otherwise cached hard).
    Recomputed at import — the server is restarted to pick up edits.
    """
    static_dir = _WEB_DIR / "static"
    try:
        latest = max(p.stat().st_mtime_ns for p in static_dir.rglob("*") if p.is_file())
    except ValueError:
        return "0"
    return format(latest, "x")


templates.env.globals["asset_v"] = _asset_version()

router = APIRouter(tags=["web"])

# Message says/asks whose text is the most representative task title.
_TITLE_MAX = 100


def _derive_title(messages: list[dict]) -> str:
    """Pick a human-readable title from the conversation (first text-bearing msg)."""
    for msg in messages:
        text = (msg.get("text") or "").strip()
        if text and not text.startswith("{"):
            first_line = text.splitlines()[0].strip()
            if first_line:
                return first_line[:_TITLE_MAX] + ("…" if len(first_line) > _TITLE_MAX else "")
    return "Untitled task"


def _parse_messages(rows: list[TaskMessage]) -> list[dict]:
    """Decode and sort stored TaskMessage rows into ClineMessage dicts."""
    parsed: list[dict] = []
    for row in rows:
        try:
            data = json.loads(row.message_data)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(data, dict):
            parsed.append(data)
    parsed.sort(key=lambda m: m.get("ts", 0))
    return parsed


async def _load_task_messages(db: AsyncSession, task_id: str) -> list[dict]:
    result = await db.execute(
        select(TaskMessage).where(TaskMessage.task_id == task_id)
    )
    return _parse_messages(list(result.scalars().all()))


@router.get("/app", response_class=HTMLResponse)
async def task_list(
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """List the logged-in user's shared tasks."""
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    # Tasks owned by the user, newest first, with message counts.
    count_sq = (
        select(TaskMessage.task_id, func.count(TaskMessage.id).label("n"))
        .group_by(TaskMessage.task_id)
        .subquery()
    )
    result = await db.execute(
        select(Task, count_sq.c.n)
        .outerjoin(count_sq, count_sq.c.task_id == Task.id)
        .where(Task.user_id == user["user_id"])
        .order_by(Task.updated_at.desc())
    )

    items = []
    for task, n in result.all():
        messages = await _load_task_messages(db, task.id)
        items.append(
            {
                "id": task.id,
                "title": _derive_title(messages),
                "message_count": n or 0,
                "updated_at": task.updated_at,
            }
        )

    return templates.TemplateResponse(
        request,
        "tasks_list.html",
        {"user": user, "tasks": items},
    )


@router.get("/app/tasks/{task_id}", response_class=HTMLResponse)
async def task_detail(
    task_id: str,
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Read-only conversation view for a task the user owns."""
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None or task.user_id != user["user_id"]:
        return templates.TemplateResponse(
            request,
            "not_found.html",
            {"user": user},
            status_code=404,
        )

    messages = await _load_task_messages(db, task_id)
    # The owner view is live: it can drive the task through the socket.io bridge
    # (extension ↔ backend ↔ browser). Disabled when the bridge is off.
    live = settings.bridge_enabled
    return templates.TemplateResponse(
        request,
        "task_detail.html",
        {
            "user": user,
            "task": task,
            "title": _derive_title(messages),
            "messages_json": json.dumps(messages),
            "share_url": None,
            "live": live,
            "can_delete": True,
            "live_config_json": json.dumps({"taskId": task_id, "bridgePath": settings.bridge_path}),
        },
    )


@router.post("/app/tasks/{task_id}/delete")
async def delete_task(
    task_id: str,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a task the user owns (row + messages + share).

    Owner-only; a non-owner / unknown id is a silent no-op (see
    ``delete_shared_task``). Always redirects back to the task list, so the
    POST is idempotent and refresh-safe.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    await delete_shared_task(db, task_id, user["user_id"])
    return RedirectResponse(url="/app", status_code=303)


@router.get("/shared/{task_id}", response_class=HTMLResponse)
async def shared_task(
    task_id: str,
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Public share-link target. Anonymous when visibility=public, else requires login."""
    result = await db.execute(select(TaskShare).where(TaskShare.task_id == task_id))
    share = result.scalar_one_or_none()

    if share is None:
        return templates.TemplateResponse(
            request,
            "not_found.html",
            {"user": user},
            status_code=404,
        )

    if share.visibility != "public" and user is None:
        # Organization/private share viewed anonymously → require login.
        return RedirectResponse(url="/app/login", status_code=303)

    # The share link is live (remote-controllable) only for the task's owner — so a
    # freshly-shared task is drivable straight from its share URL. Anonymous and
    # non-owner viewers stay strictly read-only. The backend independently enforces
    # the same owner-only rule (task:join DB ownership check + per-user command relay).
    task_result = await db.execute(select(Task).where(Task.id == task_id))
    task = task_result.scalar_one_or_none()
    is_owner = user is not None and task is not None and task.user_id == user["user_id"]
    live = bool(settings.bridge_enabled and is_owner)

    messages = await _load_task_messages(db, task_id)
    return templates.TemplateResponse(
        request,
        "task_detail.html",
        {
            "user": user,
            "task": {"id": task_id},
            "title": _derive_title(messages),
            "messages_json": json.dumps(messages),
            "share_url": share.share_url,
            "live": live,
            "can_delete": is_owner,
            "live_config_json": (
                json.dumps({"taskId": task_id, "bridgePath": settings.bridge_path})
                if live
                else "{}"
            ),
        },
    )
