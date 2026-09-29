"""The task list, the task page and deleting tasks (the web panel's /app pages).

Server-rendered (Jinja2); the conversation itself is rendered client-side by
static/render.js from the embedded ClineMessage[] JSON.
"""

import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.models.task import Task
from src.services.share_service import delete_shared_task, delete_tasks
from src.services.task_summary import derive_title
from src.services.task_tree import ancestors, subtree_size, subtrees
from src.utils.json_script import json_for_script
from src.utils.pagination import page_window
from src.web.presenters.task_detail import (
    _load_task_messages,
    _model_context,
    _quality_panel,
    _spend_summary,
    _tree_entries,
    _tree_entry,
    conversation_json,
)
from src.web.presenters.task_list import ListView
from src.web.presenters.task_rows import _list_row, _workspace_label
from src.web.templating import templates

logger = logging.getLogger(__name__)

router = APIRouter(tags=["web"])

# How many tasks one page of the list shows. The corpus on a working
# deployment runs to hundreds of tasks; rendering all of them was never a
# deliberate choice, just the absence of paging.
PAGE_SIZE = 25


@router.get("/", include_in_schema=False)
async def root_redirect():
    """The bare origin sends the reader to the task list.

    The extension opens the configured cloudApiUrl as-is (the Cloud view's
    URL link and "visit website" button), so without this the self-hosted
    origin answered 404 instead of showing the web panel.
    """
    return RedirectResponse(url="/app", status_code=307)


@router.get("/app", response_class=HTMLResponse)
async def task_list(
    request: Request,
    # Clamped below rather than validated: the pager lets a reader type a page
    # number, and an out-of-range one should land on the nearest real page
    # instead of replacing the list with a 422.
    page: int = Query(1),
    q: str = Query("", max_length=200),
    scope: str = Query("roots"),
    # The rest of the view (web/presenters/task_list.ListView): read as plain
    # strings and normalized there, so a bad value is dropped, never a 422.
    project: str = Query(""),
    model: str = Query(""),
    grade: str = Query(""),
    since: str = Query(""),
    until: str = Query(""),
    subtasks: str = Query(""),
    sort: str = Query(""),
    dir: str = Query(""),
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """List the logged-in user's shared tasks, one page at a time.

    Every column shown comes from the task row itself (see
    services/task_summary), so this is a single indexed query regardless of how
    many messages the conversations hold. It used to load and JSON-parse the
    entire corpus - 387 queries and 205 MB per request on the live deployment.

    ``scope=roots`` (the default) lists runs only and nests each run's subtasks
    under it as a collapsible tree. On the live deployment 150 of 387 tasks are
    subtasks, so listing them flat buried the actual runs among their own
    fragments, and hiding them outright left no way to see a run's shape
    without opening it. ``scope=all`` restores the flat list.

    Sorting (updated, cost, tokens, messages) and the filters are allow-listed
    GET parameters (``ListView``); the default is newest first.
    """
    view = ListView.parse(
        scope=scope, q=q, project=project, model=model, grade=grade,
        since=since, until=until, subtasks=subtasks, sort=sort, dir=dir,
    )
    user_id = user["user_id"]
    filters = view.conditions(user_id)

    total = await db.scalar(select(func.count(Task.id)).where(*filters)) or 0
    page_count = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(max(page, 1), page_count)

    order, rollup = view.order_by(user_id)
    query = select(Task).where(*filters)
    if rollup is not None:
        query = query.outerjoin(rollup, rollup.c.run_id == Task.id)
    result = await db.execute(
        query.order_by(*order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)
    )

    page_tasks = list(result.scalars().all())
    # One query per tree level for the whole page rather than a lookup per row.
    tree = await subtrees(db, [t.id for t in page_tasks], user_id)
    nest = view.scope == "roots"
    items = [_list_row(task, tree, nest) for task in page_tasks]

    # Shown on the scope toggle so the cost of switching is visible up front.
    all_total = await db.scalar(
        select(func.count(Task.id)).where(Task.user_id == user_id)
    ) or 0

    return templates.TemplateResponse(
        request,
        "tasks_list.html",
        {
            "user": user,
            "tasks": items,
            "nav_active": "tasks",
            "view": view,
            "query": view.q,
            "scope": view.scope,
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
            # What the empty state tells the reader to point the extension at.
            "api_url": settings.api_base_url,
            **await _filter_suggestions(db, user_id),
        },
    )


async def _filter_suggestions(db: AsyncSession, user_id: str) -> dict:
    """The user's own projects and models, offered as the filter fields'
    suggestions (a <datalist>, so any other text can still be typed).

    Two DISTINCT reads over the user's rows; the project is offered by its
    badge label (the last path segment), which is what the filter matches.
    """
    paths = await db.scalars(
        select(Task.workspace_path)
        .where(Task.user_id == user_id, Task.workspace_path.is_not(None))
        .distinct()
    )
    labels = {label for label in (_workspace_label(p) for p in paths.all()) if label}
    joined = await db.scalars(
        select(Task.models).where(Task.user_id == user_id, Task.models.is_not(None)).distinct()
    )
    models = {m.strip() for value in joined.all() for m in value.split(",") if m.strip()}
    return {
        "project_options": sorted(labels, key=str.lower),
        "model_options": sorted(models, key=str.lower),
    }


@router.get("/app/tasks/{task_id}", response_class=HTMLResponse)
async def task_detail(
    task_id: str,
    request: Request,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Read-only conversation view for a task the user owns."""
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
    spend = _spend_summary(task, tree)
    live_config = {"taskId": task_id, "bridgePath": settings.bridge_path}
    if spend["subtasks"]:
        rest = spend["subtasks"]
        live_config["subtasks"] = {
            "tokensIn": rest.tokens_in,
            "tokensOut": rest.tokens_out,
            "cost": rest.cost,
        }
    return templates.TemplateResponse(
        request,
        "task_detail.html",
        {
            "user": user,
            "task": task,
            "ancestors": [_tree_entry(t) for t in trail],
            "subtasks": _tree_entries(tree, task_id),
            "subtask_count": subtree_size(tree, task_id),
            "spend_table": spend,
            "quality": _quality_panel(task),
            # The stored title is authoritative; deriving it again is only a
            # fallback for a row written before the summary columns existed and
            # somehow missed the migration's backfill.
            "title": task.title or derive_title(messages),
            "workspace": task.workspace_path,
            "workspace_label": _workspace_label(task.workspace_path),
            "messages_json": await conversation_json(messages),
            **await _model_context(db, task_id, task.user_id, messages),
            "share_url": None,
            "live": live,
            "can_delete": True,
            # A conversation is prose, so the page switches to the reading
            # measure instead of the wider scanning column the list uses.
            "read_measure": True,
            "live_config_json": json_for_script(live_config),
        },
    )


@router.post("/app/tasks/{task_id}/delete")
async def delete_task(
    task_id: str,
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a task the user owns (row + messages + share).

    Owner-only; a non-owner / unknown id is a silent no-op (see
    ``delete_shared_task``). Always redirects back to the task list, so the
    POST is idempotent and refresh-safe.
    """
    await delete_shared_task(db, task_id, user["user_id"])
    return RedirectResponse(url="/app", status_code=303)


@router.post("/app/tasks/bulk-delete")
async def bulk_delete_tasks(
    request: Request,
    user: WebUser = Depends(require_web_user),
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
    form = await request.form()
    task_ids = [t for t in form.getlist("task_ids") if isinstance(t, str) and t]
    include_subtasks = form.get("include_subtasks") == "1"

    deleted = 0
    if task_ids:
        deleted = await delete_tasks(
            db, task_ids, user["user_id"], include_subtasks=include_subtasks
        )
        logger.info("[web] bulk delete: %s task(s) removed for %s", deleted, user["user_id"])

    # Back to the same view (scope, search, filters, sort), which the form
    # carries as hidden fields, but to its first page: selecting on page 3 and
    # deleting everything on it would otherwise leave the reader on a page
    # that no longer exists. ListView re-validates every value and encodes
    # them: a raw "&" would start a new parameter, "#" would cut the rest off
    # into a fragment and "+" would read back as a space.
    def field(name: str) -> str:
        value = form.get(name)
        return value if isinstance(value, str) else ""

    view = ListView.parse(**{name: field(name) for name in _VIEW_FIELDS})
    return RedirectResponse(url=view.url(), status_code=303)


_VIEW_FIELDS = ("scope", "q", "project", "model", "grade", "since", "until", "subtasks", "sort", "dir")
