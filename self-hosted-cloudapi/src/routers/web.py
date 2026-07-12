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
import re
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
from src.models.organization import Membership
from src.services.share_service import delete_shared_task
from src.services.metrics_service import (
    DEFAULT_PERIOD,
    PERIOD_LABELS,
    compute_user_metrics,
)
from src.utils.format import fmt_duration, fmt_tokens, num

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

# Roo Code's first user turn can reach the cloud in API-prompt form: the typed
# text wrapped in <user_message>/<task>/<feedback>, trailed by a machine-built
# <environment_details> block (current mode, open tabs, file tree, cost…). None
# of the environment block is the user's query, so strip it before deriving a
# title. Match the trailing/unclosed case too (the block is always last).
_ENV_DETAILS_RE = re.compile(r"<environment_details>.*?(?:</environment_details>|\Z)", re.DOTALL)
_MSG_WRAPPER_RE = re.compile(r"<(user_message|task|feedback)>(.*?)</\1>", re.DOTALL)


def _strip_task_wrappers(text: str) -> str:
    """Reduce a raw conversation message to the human-authored query.

    Drops the machine ``<environment_details>`` appendix and unwraps the
    ``<user_message>``/``<task>``/``<feedback>`` tag to its inner content. Plain
    text (already clean) passes through unchanged.
    """
    if not text:
        return ""
    cleaned = _ENV_DETAILS_RE.sub("", text)
    match = _MSG_WRAPPER_RE.search(cleaned)
    if match:
        cleaned = match.group(2)
    return cleaned.strip()


def _workspace_label(path: str | None) -> str | None:
    """Compact project/worktree name for a badge: the last path segment.

    The full absolute path is kept for the tooltip/header so sibling worktrees
    that share a basename (e.g. two checkouts both named ``Roo-Code``) can still
    be told apart on hover. Handles both POSIX and Windows separators since the
    path is whatever the client's OS reported.
    """
    if not path:
        return None
    trimmed = path.replace("\\", "/").rstrip("/")
    if not trimmed:
        return None
    return trimmed.rsplit("/", 1)[-1] or trimmed


def _derive_title(messages: list[dict]) -> str:
    """Pick a human-readable title from the conversation (first text-bearing msg).

    The first candidate is unwrapped to the user's query (machine framing such as
    ``<environment_details>`` is dropped) so the title reflects what the user
    actually typed, not the current mode/file tree the extension appended.
    """
    for msg in messages:
        text = (msg.get("text") or "").strip()
        if not text or text.startswith("{"):
            continue
        query = _strip_task_wrappers(text)
        if not query:
            continue
        first_line = query.splitlines()[0].strip()
        if first_line:
            return first_line[:_TITLE_MAX] + ("…" if len(first_line) > _TITLE_MAX else "")
    return "Untitled task"


def _compute_metrics(messages: list[dict]) -> dict:
    """Sum token/cost totals from a task's messages.

    Server-side port of ``getMetrics`` in static/render.js (the aggregation the
    VS Code view and live header use): over every ``api_req_started`` say-message
    add ``tokensIn``/``tokensOut``/``cost`` (plus ``cacheWrites``/``cacheReads`` for
    the hover breakdown) parsed from its JSON ``text``, plus the cost of any
    ``condense_context`` message. ``duration_ms`` spans the first→last message ts.
    ``contextTokens`` is deliberately omitted — it's a live header gauge, not a total.
    """
    tokens_in = 0
    tokens_out = 0
    cache_writes = 0
    cache_reads = 0
    cost = 0.0
    first_ts: Optional[int] = None
    last_ts: Optional[int] = None
    for msg in messages:
        ts = msg.get("ts")
        if isinstance(ts, (int, float)):
            first_ts = ts if first_ts is None else min(first_ts, ts)
            last_ts = ts if last_ts is None else max(last_ts, ts)
        if msg.get("type") != "say":
            continue
        say = msg.get("say")
        if say == "api_req_started" and msg.get("text"):
            try:
                obj = json.loads(msg["text"])
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(obj, dict):
                tokens_in += num(obj.get("tokensIn"))
                tokens_out += num(obj.get("tokensOut"))
                cache_writes += num(obj.get("cacheWrites"))
                cache_reads += num(obj.get("cacheReads"))
                cost += num(obj.get("cost"))
        elif say == "condense_context":
            condense = msg.get("contextCondense")
            if isinstance(condense, dict):
                cost += num(condense.get("cost"))
    return {
        "tokens_in": int(tokens_in),
        "tokens_out": int(tokens_out),
        "cache_writes": int(cache_writes),
        "cache_reads": int(cache_reads),
        "cost": cost,
        "duration_ms": (last_ts - first_ts) if (first_ts is not None and last_ts is not None) else 0,
    }


def _metrics_tooltip(metrics: dict) -> str:
    """Multi-line hover breakdown (native title tooltips honour the newlines)."""
    lines = [
        f"↑ In: {metrics['tokens_in']:,}",
        f"↓ Out: {metrics['tokens_out']:,}",
    ]
    if metrics["cache_writes"] or metrics["cache_reads"]:
        lines.append(f"⚡ Cache: {metrics['cache_writes']:,} write / {metrics['cache_reads']:,} read")
    if metrics["duration_ms"]:
        lines.append(f"⏱ Session: {fmt_duration(metrics['duration_ms'])}")
    lines.append(f"$ Cost: ${metrics['cost']:.4f}")
    return "\n".join(lines)


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
        metrics = _compute_metrics(messages)
        total_tokens = metrics["tokens_in"] + metrics["tokens_out"]
        has_metrics = total_tokens > 0 or metrics["cost"] > 0
        items.append(
            {
                "id": task.id,
                "title": _derive_title(messages),
                "message_count": n or 0,
                "updated_at": task.updated_at,
                "tokens": fmt_tokens(total_tokens) if total_tokens else None,
                "cost": f"${metrics['cost']:.4f}" if metrics["cost"] > 0 else None,
                "metrics_title": _metrics_tooltip(metrics) if has_metrics else None,
                "workspace": task.workspace_path,
                "workspace_label": _workspace_label(task.workspace_path),
            }
        )

    return templates.TemplateResponse(
        request,
        "tasks_list.html",
        {"user": user, "tasks": items, "nav_active": "tasks"},
    )


@router.get("/app/metrics", response_class=HTMLResponse)
async def metrics_page(
    request: Request,
    period: str = DEFAULT_PERIOD,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Usage-metrics dashboard for the logged-in user.

    Aggregates LLM Completion telemetry (tokens / cost / duration / models /
    modes) over the selected period. See services/metrics_service.py.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    metrics = await compute_user_metrics(db, user["user_id"], period)
    periods = [
        {"key": key, "label": label, "active": key == metrics["period"]}
        for key, label in PERIOD_LABELS.items()
    ]
    return templates.TemplateResponse(
        request,
        "metrics.html",
        {
            "user": user,
            "nav_active": "metrics",
            "metrics": metrics,
            "periods": periods,
            "chart_json": json.dumps(metrics["chart"]),
        },
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
            "workspace": task.workspace_path,
            "workspace_label": _workspace_label(task.workspace_path),
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

    # For non-public shares, enforce org membership: the viewer must be the task
    # owner or share an organization with the task owner. This prevents a logged-in
    # user from a different org reading another org's private conversation.
    if share.visibility != "public" and not is_owner:
        allowed = False
        if task is not None and task.organization_id is not None and user is not None:
            member_result = await db.execute(
                select(Membership).where(
                    Membership.user_id == user["user_id"],
                    Membership.organization_id == task.organization_id,
                )
            )
            allowed = member_result.scalar_one_or_none() is not None
        if not allowed:
            return templates.TemplateResponse(
                request,
                "not_found.html",
                {"user": user},
                status_code=404,
            )

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
