"""The public share-link target (/shared/{task_id}).

Who may look is decided by services/task_access; this route renders the
answer. The page is the task page's template, read-only unless the viewer owns
the task.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.auth.web_session import LoginRequired, WebUser, get_web_user_optional
from src.database import get_db
from src.services.task_access import ShareVerdict, shared_view_access
from src.services.task_summary import derive_title
from src.utils.json_script import json_for_script
from src.web.presenters.task_detail import (
    _load_task_messages,
    _model_context,
    _spend_summary,
    conversation_json,
)
from src.web.templating import templates

router = APIRouter(tags=["web"])


@router.get("/shared/{task_id}", response_class=HTMLResponse)
async def shared_task(
    task_id: str,
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Public share-link target. Anonymous when visibility=public, else requires login."""
    access = await shared_view_access(db, task_id, user)
    if access.verdict is ShareVerdict.LOGIN_REQUIRED:
        raise LoginRequired()
    if access.verdict is ShareVerdict.NOT_FOUND:
        return templates.TemplateResponse(
            request,
            "not_found.html",
            {"user": user},
            status_code=404,
        )
    share, task, is_owner = access.share, access.task, access.is_owner

    live = bool(settings.bridge_enabled and is_owner)

    messages = await _load_task_messages(db, task_id)
    return templates.TemplateResponse(
        request,
        "task_detail.html",
        {
            "user": user,
            "task": {"id": task_id},
            "title": (task.title if task is not None else None) or derive_title(messages),
            "messages_json": await conversation_json(messages),
            # Provenance travels with the transcript: a reader of a shared run
            # should be able to see what produced it, not just what it said.
            **await _model_context(
                db, task_id, task.user_id if task is not None else None, messages
            ),
            "share_url": share.share_url,
            "live": live,
            # The live header's figures, for the owner only, as before: a
            # reader of a shared link is shown the conversation, not its bill.
            "spend_table": _spend_summary(task, {}) if live and task is not None else None,
            "can_delete": is_owner,
            "read_measure": True,
            "live_config_json": (
                json_for_script({"taskId": task_id, "bridgePath": settings.bridge_path})
                if live
                else json_for_script({})
            ),
        },
    )
