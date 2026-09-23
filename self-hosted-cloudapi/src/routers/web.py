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
import textwrap
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.database import get_db
from src.auth.web_session import WebUser, get_web_user_optional
from src.models.task import Task, TaskMessage, TaskShare
from src.models.organization import Membership
from src.models.retention import (
    SUGGESTED_MAX_AGE_DAYS,
    SUGGESTED_MAX_TASKS,
    SUGGESTED_TELEMETRY_MAX_AGE_DAYS,
)
from src.services.model_attribution import (
    attribute_requests,
    completions_for_task,
    models_badge,
    models_label,
    models_summary,
    side_calls_summary,
)
from src.services.retention_service import apply_sweep, get_policy, plan_sweep
from src.services.share_service import delete_shared_task, delete_tasks
from src.services.metrics_service import (
    DEFAULT_PERIOD,
    PERIOD_LABELS,
    compute_user_metrics,
    period_start,
)
from src.services.session_quality import (
    GRADE_CLEAN,
    GRADE_FRICTION,
    GRADE_LABELS,
    GRADE_UNFINISHED,
    quality_of,
)
from src.services.task_summary import DEFAULT_TITLE, derive_title, duration_ms
from src.services.task_tree import Spend, ancestors, subtree_size, subtree_spend, subtrees
from src.utils.format import fmt_duration, fmt_tokens
from src.utils.pagination import page_window

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

# How many tasks one page of the list shows. The corpus on a working
# deployment runs to hundreds of tasks; rendering all of them was never a
# deliberate choice, just the absence of paging.
PAGE_SIZE = 25


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


def _quality_fields(task: Task) -> dict:
    """Grade + the account it was derived from, for a list row or a tree entry.

    The reasons travel with the grade everywhere it is shown, so a badge is
    never a verdict the reader has to take on trust.
    """
    q = quality_of(task)
    return {
        "grade": q.grade,
        "grade_label": q.grade_label,
        "grade_title": "; ".join(q.reasons()),
    }


def _quality_panel(task: Task) -> dict:
    """Every quality signal for one task, for the detail page.

    Efficiency figures sit alongside the friction counts because they answer the
    other half of "how did this go?": tokens per turn and how much of the input
    came from cache are what separate an expensive run from a wasteful one.
    """
    q = quality_of(task)
    tokens_in = task.tokens_in or 0
    cache_reads = task.cache_reads or 0
    # `cacheReads` is a subset of `tokensIn` in every payload this deployment has
    # stored (0 of 13 164 completions exceed it; the highest task-level ratio is
    # 98%), so the share is taken over the input. Clamped anyway: the figures
    # come from whichever provider the client used, and a share above 100% would
    # be a nonsense number presented with full confidence.
    cache_share = min(100, round(100 * cache_reads / tokens_in)) if tokens_in else None
    per_request = round(tokens_in / q.requests) if q.requests else None
    return {
        "grade": q.grade,
        "grade_label": q.grade_label,
        "reasons": q.reasons(),
        "signals": [
            {"label": "Turns", "value": q.requests, "tone": "neutral"},
            {"label": "Tool calls", "value": q.tools, "tone": "neutral"},
            {"label": "Your corrections", "value": q.interventions, "tone": "bad"},
            {"label": "Replies to a result", "value": q.completion_replies, "tone": "neutral"},
            {"label": "Errors", "value": q.errors, "tone": "bad"},
            {"label": "Provider retries", "value": q.retries, "tone": "bad"},
            {"label": "Context condensed", "value": q.condense, "tone": "warn"},
            {"label": "Repeated tool calls", "value": q.repeated_work, "tone": "warn"},
        ],
        "efficiency": [
            {"label": "Tokens / turn", "value": f"{per_request:,}" if per_request else "—"},
            {"label": "From cache", "value": f"{cache_share}%" if cache_share is not None else "—"},
            {
                "label": "Cost / turn",
                "value": f"${task.cost / q.requests:.4f}" if q.requests and task.cost else "—",
            },
        ],
    }


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _spend_fields(task: Task, tree: dict[str, list[Task]]) -> dict:
    """The tokens and cost cells, and the hover that explains them.

    A task that delegated shows what its whole run consumed: itself plus every
    subtask beneath it. Its own figures alone were the parent's share only, on
    the live corpus often a fraction of the run (a $0.1656 row whose two
    subtasks cost $1.2434 more). The cells are marked as sums and their hover
    splits them into this task and its subtasks; a task with no subtasks shows
    its own figures, unmarked, as before.
    """
    own = Spend.of(task)
    total = subtree_spend(tree, task)
    subtasks = subtree_size(tree, task.id)
    fields = {
        "tokens": fmt_tokens(total.tokens) if total.tokens else None,
        "cost": f"${total.cost:.4f}" if total.cost > 0 else None,
        "rollup": subtasks > 0,
        "tokens_title": None,
        "cost_title": None,
        # The prompt the run started from, then its figures: the one thing a
        # row 100 characters wide cannot show.
        "hover_title": _row_tooltip(task, total if subtasks else None, subtasks),
    }
    if subtasks:
        rest = total - own
        where = _plural(subtasks, "subtask")
        fields["tokens_title"] = (
            f"{total.tokens:,} tokens for the run: {own.tokens:,} this task + {rest.tokens:,} in {where}"
        )
        fields["cost_title"] = (
            f"${total.cost:.4f} for the run: ${own.cost:.4f} this task + ${rest.cost:.4f} in {where}"
        )
    return fields


def _tree_entry(task: Task, tree: Optional[dict[str, list[Task]]] = None) -> dict:
    """Compact view-model for a task shown as somebody else's relative.

    Used by the breadcrumb and the subtask panel, where a task appears as a link
    with its own headline figures rather than as a full list row. Given the
    tree beneath it, a subtask that delegated further shows its run's figures,
    the same as it would as a list row.
    """
    span = duration_ms(task.first_ts, task.last_ts)
    return {
        "id": task.id,
        "title": task.title or DEFAULT_TITLE,
        "message_count": task.message_count or 0,
        "duration": fmt_duration(span) if span else None,
        # Same hover as a list row: a subtask's title is the least informative
        # of all, since a delegated run is usually named by one instruction.
        **_spend_fields(task, tree or {}),
        **_quality_fields(task),
    }


def _tree_entries(tree: dict[str, list[Task]], task_id: str) -> list[dict]:
    """The subtasks beneath ``task_id`` as nested tree entries, oldest first."""
    return [
        {**_tree_entry(child, tree), "children": _tree_entries(tree, child.id)}
        for child in tree.get(task_id, [])
    ]


def _run_summary(task: Task, tree: dict[str, list[Task]]) -> Optional[dict]:
    """The subtask panel's headline: what the whole run cost, and how it splits.

    None for a task with no subtasks, which has no run beyond itself.
    """
    subtasks = subtree_size(tree, task.id)
    if not subtasks:
        return None
    own = Spend.of(task)
    total = subtree_spend(tree, task)
    rest = total - own
    return {
        "cost": f"${total.cost:.4f}",
        "own_cost": f"${own.cost:.4f}",
        "subtasks_cost": f"${rest.cost:.4f}",
        "tokens": fmt_tokens(total.tokens),
    }


def _list_row(task: Task, tree: dict[str, list[Task]], nest: bool) -> dict:
    """View-model for one row of the task list.

    With ``nest`` the row carries its subtasks as rows of their own, so the run
    view renders the whole delegation tree under each run. The flat view lists
    subtasks as ordinary rows instead, so nesting them there would show each
    one twice.
    """
    kids = tree.get(task.id, [])
    span = duration_ms(task.first_ts, task.last_ts)
    return {
        "id": task.id,
        "title": task.title or DEFAULT_TITLE,
        "message_count": task.message_count or 0,
        "updated_at": task.updated_at,
        "duration": fmt_duration(span) if span else None,
        **_spend_fields(task, tree),
        "workspace": task.workspace_path,
        "workspace_label": _workspace_label(task.workspace_path),
        # Read straight off the row: the list must never parse an event
        # payload per task (see services/model_attribution).
        "models": models_badge(task.models),
        "child_count": len(kids),
        # What "include their subtasks" adds to a bulk delete: the whole
        # subtree, because that is what the delete removes, not only the
        # direct children the pill counts.
        "descendant_count": subtree_size(tree, task.id),
        "is_subtask": task.parent_task_id is not None,
        "children": [_list_row(kid, tree, nest) for kid in kids] if nest else [],
        **_quality_fields(task),
    }


# A native tooltip does not wrap, so a paragraph-long excerpt would render as
# one line wider than the screen. Wrapped here rather than at write time: the
# stored excerpt stays raw text, and the width is a rendering decision.
_PROMPT_WRAP_COLS = 78
_PROMPT_WRAP_LINES = 14


def _wrap_prompt(prompt: Optional[str]) -> list[str]:
    """Lay the stored excerpt out for a fixed-width tooltip.

    Each authored line is wrapped in place (so a bulleted brief keeps its
    bullets), and the whole thing is capped in height — an excerpt of 30 short
    lines is within the character cap but taller than the hover should be.
    """
    if not prompt:
        return []
    lines: list[str] = []
    for line in prompt.splitlines():
        if not line.strip():
            lines.append("")
            continue
        # break_on_hyphens off: a URL or a kebab-case path is one token to a
        # reader, and "local-inference-\nlab/..." reads as a hyphenation that
        # isn't there. Long words are still broken — a 1000-character token with
        # no whitespace has to be bounded somehow.
        lines.extend(
            textwrap.wrap(line, width=_PROMPT_WRAP_COLS, break_on_hyphens=False) or [""]
        )
        if len(lines) > _PROMPT_WRAP_LINES:
            break
    if len(lines) > _PROMPT_WRAP_LINES:
        lines = lines[:_PROMPT_WRAP_LINES]
        if not lines[-1].endswith("…"):
            # Room made for the mark rather than taken: a full-width last line
            # plus an ellipsis is the one line that would exceed the column.
            lines[-1] = lines[-1][: _PROMPT_WRAP_COLS - 1].rstrip() + "…"
    return lines


def _metrics_tooltip(task: Task) -> list[str]:
    """The token/cost breakdown, one figure per line.

    Reads the denormalized columns on the task row — the whole point of
    services/task_summary is that the list never re-derives these.
    """
    lines = [
        f"↑ In: {task.tokens_in:,}",
        f"↓ Out: {task.tokens_out:,}",
    ]
    if task.cache_writes or task.cache_reads:
        lines.append(f"⚡ Cache: {task.cache_writes:,} write / {task.cache_reads:,} read")
    span = duration_ms(task.first_ts, task.last_ts)
    if span:
        lines.append(f"⏱ Session: {fmt_duration(span)}")
    lines.append(f"$ Cost: ${task.cost:.4f}")
    return lines


def _run_tooltip(total: Spend, subtasks: int) -> list[str]:
    """The same breakdown for a task together with its subtasks."""
    lines = [
        f"Σ With its {_plural(subtasks, 'subtask')}",
        f"↑ In: {total.tokens_in:,}",
        f"↓ Out: {total.tokens_out:,}",
    ]
    if total.cache_writes or total.cache_reads:
        lines.append(f"⚡ Cache: {total.cache_writes:,} write / {total.cache_reads:,} read")
    lines.append(f"$ Cost: ${total.cost:.4f}")
    return lines


def _row_tooltip(task: Task, total: Optional[Spend] = None, subtasks: int = 0) -> Optional[str]:
    """What hovering a task row says: the request, then what it cost.

    The prompt leads because it is the thing the row cannot show — the title
    column carries only its first line, cut at 100 characters. Both halves come
    off the task row itself, so this costs the list nothing (native title
    tooltips honour the newlines).

    With ``total`` (the task and its ``subtasks`` together) the task's own
    figures are headed as such and the run's follow, so the hover accounts for
    the sum the row shows.

    ``None`` when there is neither an excerpt nor a figure to report, so the
    row gets no empty tooltip.
    """
    blocks = []
    prompt = _wrap_prompt(task.prompt_excerpt)
    if prompt:
        blocks.append("\n".join(prompt))
    if (task.tokens_in or 0) or (task.tokens_out or 0) or (task.cost or 0):
        own = _metrics_tooltip(task)
        blocks.append("\n".join(["This task", *own] if total else own))
    if total and (total.tokens or total.cost):
        blocks.append("\n".join(_run_tooltip(total, subtasks)))
    return "\n\n".join(blocks) or None


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


async def _model_context(db: AsyncSession, task_id: str, messages: list[dict]) -> dict:
    """What answered, for one conversation: the rollup and the per-request map.

    Both come from the same indexed read of the task's ``LLM Completion``
    events, because the stored conversation cannot say it — see
    services/model_attribution. The map goes to the browser as its own JSON
    island keyed by message ``ts``: the ``api_req_started`` payload is a
    verbatim copy of what the client sent, and derived data is not written back
    into it.
    """
    completions = await completions_for_task(db, task_id)
    return {
        "models": models_summary(completions),
        "models_label": models_label(completions),
        # Condensing, prompt enhancement and memory recall: real requests on
        # real models that are not turns, so they are named apart from the
        # conversation rather than mixed into it.
        "side_calls": side_calls_summary(completions),
        "request_models_json": json.dumps(attribute_requests(messages, completions)),
    }


async def _load_task_messages(db: AsyncSession, task_id: str) -> list[dict]:
    result = await db.execute(
        select(TaskMessage).where(TaskMessage.task_id == task_id)
    )
    return _parse_messages(list(result.scalars().all()))


@router.get("/app", response_class=HTMLResponse)
async def task_list(
    request: Request,
    # Clamped below rather than validated: the pager lets a reader type a page
    # number, and an out-of-range one should land on the nearest real page
    # instead of replacing the list with a 422.
    page: int = Query(1),
    q: str = Query("", max_length=200),
    scope: str = Query("roots"),
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """List the logged-in user's shared tasks, newest first, one page at a time.

    Every column shown comes from the task row itself (see
    services/task_summary), so this is a single indexed query regardless of how
    many messages the conversations hold. It used to load and JSON-parse the
    entire corpus — 387 queries and 205 MB per request on the live deployment.

    ``scope=roots`` (the default) lists runs only and nests each run's subtasks
    under it as a collapsible tree. On the live deployment 150 of 387 tasks are
    subtasks, so listing them flat buried the actual runs among their own
    fragments, and hiding them outright left no way to see a run's shape
    without opening it. ``scope=all`` restores the flat list.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    search = q.strip()
    scope = scope if scope in ("roots", "all") else "roots"
    filters = [Task.user_id == user["user_id"]]
    if search:
        pattern = f"%{search}%"
        filters.append(or_(Task.title.ilike(pattern), Task.workspace_path.ilike(pattern)))
    if scope == "roots":
        filters.append(Task.parent_task_id.is_(None))

    total = await db.scalar(select(func.count(Task.id)).where(*filters)) or 0
    page_count = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(max(page, 1), page_count)

    result = await db.execute(
        select(Task)
        .where(*filters)
        .order_by(Task.updated_at.desc())
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )

    page_tasks = list(result.scalars().all())
    # One query per tree level for the whole page rather than a lookup per row.
    tree = await subtrees(db, [t.id for t in page_tasks], user["user_id"])
    nest = scope == "roots"
    items = [_list_row(task, tree, nest) for task in page_tasks]

    # Shown on the scope toggle so the cost of switching is visible up front.
    all_total = await db.scalar(
        select(func.count(Task.id)).where(Task.user_id == user["user_id"])
    ) or 0

    return templates.TemplateResponse(
        request,
        "tasks_list.html",
        {
            "user": user,
            "tasks": items,
            "nav_active": "tasks",
            "query": search,
            "scope": scope,
            "tree_view": nest,
            "page": page,
            "page_count": page_count,
            # Numbered links, so any page is one click away rather than N
            # clicks of "Older"; None entries render as an ellipsis.
            "pages": page_window(page, page_count),
            "total": total,
            "all_total": all_total,
            "has_prev": page > 1,
            "has_next": page < page_count,
        },
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
    quality = await _quality_overview(db, user["user_id"], period)
    return templates.TemplateResponse(
        request,
        "metrics.html",
        {
            "user": user,
            "nav_active": "metrics",
            "metrics": metrics,
            "quality": quality,
            "periods": periods,
            "chart_json": json.dumps(metrics["chart"]),
        },
    )


async def _quality_overview(db: AsyncSession, user_id: str, period: str) -> dict:
    """How the user's runs went over the period, in aggregate.

    Reads the stored per-task counts, so this is one query over `tasks` rather
    than a walk of any conversation. Subtasks are excluded: a run and the
    subtasks it delegated to would otherwise each be graded, counting one piece
    of work several times.

    The period bound is on ``updated_at`` — when the task was last written —
    which is the only time the task row itself carries.
    """
    filters = [Task.user_id == user_id, Task.parent_task_id.is_(None)]
    start = period_start(period)
    if start is not None:
        filters.append(Task.updated_at >= start)

    result = await db.execute(select(Task).where(*filters))
    tasks = list(result.scalars().all())
    if not tasks:
        return {"has_data": False}

    grades = {GRADE_CLEAN: 0, GRADE_FRICTION: 0, GRADE_UNFINISHED: 0}
    totals = {
        "interventions": 0,
        "completion_replies": 0,
        "errors": 0,
        "retries": 0,
        "condense": 0,
        "repeated_work": 0,
        "requests": 0,
    }
    ranked = []
    for task in tasks:
        q = quality_of(task)
        grades[q.grade] += 1
        for key in totals:
            totals[key] += getattr(q, key)
        if q.friction_events:
            ranked.append(
                {
                    "id": task.id,
                    "title": task.title or DEFAULT_TITLE,
                    "friction": q.friction_events,
                    "reasons": "; ".join(q.reasons()),
                }
            )
    ranked.sort(key=lambda r: r["friction"], reverse=True)

    total = len(tasks)
    return {
        "has_data": True,
        "total": total,
        "grades": [
            {
                "key": key,
                "label": GRADE_LABELS[key],
                "count": grades[key],
                "share": round(100 * grades[key] / total),
            }
            for key in (GRADE_CLEAN, GRADE_FRICTION, GRADE_UNFINISHED)
        ],
        "totals": totals,
        # Enough to act on, not a second full list.
        "roughest": ranked[:8],
    }


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
    # Nearest-first from ancestors(); the trail reads root → … → here.
    trail = list(reversed(await ancestors(db, task)))
    # The whole tree beneath this task, not only its direct children: a
    # subtask that delegated further is otherwise a dead end until opened.
    tree = await subtrees(db, [task_id], user["user_id"])
    return templates.TemplateResponse(
        request,
        "task_detail.html",
        {
            "user": user,
            "task": task,
            "ancestors": [_tree_entry(t) for t in trail],
            "subtasks": _tree_entries(tree, task_id),
            "subtask_count": subtree_size(tree, task_id),
            "run": _run_summary(task, tree),
            "quality": _quality_panel(task),
            # The stored title is authoritative; deriving it again is only a
            # fallback for a row written before the summary columns existed and
            # somehow missed the migration's backfill.
            "title": task.title or derive_title(messages),
            "workspace": task.workspace_path,
            "workspace_label": _workspace_label(task.workspace_path),
            "messages_json": json.dumps(messages),
            **await _model_context(db, task_id, messages),
            "share_url": None,
            "live": live,
            "can_delete": True,
            # A conversation is prose, so the page switches to the reading
            # measure instead of the wider scanning column the list uses.
            "read_measure": True,
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


@router.get("/app/settings", response_class=HTMLResponse)
async def settings_page(
    request: Request,
    ran: str = Query(""),
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Retention settings, with a preview of exactly what a sweep would remove.

    The preview is computed by the same function the sweep acts on, so what is
    shown here and what would be deleted cannot drift apart. It renders whether
    or not retention is switched on — before you arm it is the one moment the
    preview is genuinely worth reading.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    policy = await get_policy(db, user["user_id"])
    plan = await plan_sweep(db, user["user_id"], policy)
    await db.commit()

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
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Save the retention policy. Saving never deletes anything.

    Arming a policy and running it are deliberately separate actions: switching
    retention on should not silently remove hundreds of conversations in the
    same click that turned it on. Deleting happens on "Run now", or on the
    scheduled sweep.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

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
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Apply the saved policy immediately.

    Runs regardless of the ``enabled`` switch: the button is an explicit
    instruction, and the switch only governs the scheduled sweep.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

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


def _plan_view(plan) -> dict:
    """View-model for the preview, including a readable size."""
    return {
        "task_count": plan.task_count,
        "message_count": plan.message_count,
        "event_count": plan.event_count,
        "exempt_shared": plan.exempt_shared,
        "total_bytes": plan.total_bytes,
        "size": _fmt_bytes(plan.total_bytes),
        "is_empty": plan.is_empty,
        "reasons": sorted(set(plan.reasons.values())),
    }


def _fmt_bytes(n: int) -> str:
    """Human size. Stated as an approximation — see RetentionPlan.message_bytes."""
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if abs(size) < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


@router.post("/app/tasks/bulk-delete")
async def bulk_delete_tasks(
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete every selected task the user owns.

    Ownership is enforced per id inside ``delete_tasks``, not here: the form
    posts a list, and a caller is free to put anything in it. Ids the user does
    not own are dropped silently rather than rejected, so a tampered list
    deletes exactly what the caller was entitled to delete and discloses nothing
    about the rest.

    Always redirects back to the list, so the POST is refresh-safe.
    """
    if user is None:
        return RedirectResponse(url="/app/login", status_code=303)

    form = await request.form()
    task_ids = [t for t in form.getlist("task_ids") if isinstance(t, str) and t]
    include_subtasks = form.get("include_subtasks") == "1"

    deleted = 0
    if task_ids:
        deleted = await delete_tasks(
            db, task_ids, user["user_id"], include_subtasks=include_subtasks
        )
        logger.info("[web] bulk delete: %s task(s) removed for %s", deleted, user["user_id"])

    # Selecting on page 3 and deleting everything on it would otherwise leave the
    # reader on a page that no longer exists.
    scope = form.get("scope") or "roots"
    query = form.get("q") or ""
    target = f"/app?scope={scope}"
    if query:
        target += f"&q={query}"
    return RedirectResponse(url=target, status_code=303)


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
            "title": (task.title if task is not None else None) or derive_title(messages),
            "messages_json": json.dumps(messages),
            # Provenance travels with the transcript: a reader of a shared run
            # should be able to see what produced it, not just what it said.
            **await _model_context(db, task_id, messages),
            "share_url": share.share_url,
            "live": live,
            "can_delete": is_owner,
            "read_measure": True,
            "live_config_json": (
                json.dumps({"taskId": task_id, "bridgePath": settings.bridge_path})
                if live
                else "{}"
            ),
        },
    )
