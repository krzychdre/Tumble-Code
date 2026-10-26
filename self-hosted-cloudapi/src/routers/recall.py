"""Cross-session recall API for the extension (/api/recall).

The contract is section 7 of ai_plans/2026-10-26_18-22_cross-session-recall.md.
The client names its folder; the user and the tenant come from the token, and
the folder resolves to a project within them only (services/projects). A
folder whose project has recall off answers 404, like a session the reader
may not see.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.project import SCOPE_NONE, Project
from src.services.projects import resolve_project
from src.services.recall_search import (
    LIMIT_MAX,
    QUERY_MAX,
    BadQuery,
    Hit,
    iso,
    read,
    search,
)

router = APIRouter(prefix="/api/recall", tags=["recall"])


class Folder:
    """The folder parameters every recall call carries."""

    def __init__(
        self,
        workspace_path: str = Query(..., alias="workspacePath", min_length=1),
        repository_url: str = Query("", alias="repositoryUrl"),
    ):
        self.workspace_path = workspace_path
        self.repository_url = repository_url


async def _project(db: AsyncSession, current_user: dict, folder: Folder) -> Project:
    return await resolve_project(
        db,
        current_user["user_id"],
        current_user["org_id"],
        folder.workspace_path,
        folder.repository_url,
    )


async def _recall_on(db: AsyncSession, current_user: dict, folder: Folder) -> Project:
    project = await _project(db, current_user, folder)
    if project.recall_scope == SCOPE_NONE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return project


def _bad_query() -> HTTPException:
    # 400 rather than FastAPI's 422, as the contract promises the tool.
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"The query needs a searchable word and at most {QUERY_MAX} characters.",
    )


def _hit_fields(hit: Hit) -> dict:
    return {
        "sessionId": hit.session_id,
        "projectName": hit.project_name,
        "author": hit.author,
        "lastActivity": iso(hit.last_ts),
        "title": hit.title,
    }


@router.get("/context")
async def recall_context(
    folder: Folder = Depends(),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The folder's project and its recall scope; the tools exist unless ``none``."""
    project = await _project(db, current_user, folder)
    await db.commit()
    return {
        "projectId": project.id,
        "projectName": project.name,
        "scope": project.recall_scope,
    }


@router.get("/search")
async def recall_search(
    folder: Folder = Depends(),
    q: str = Query(""),
    scope: Literal["this_project", "all"] = Query("all"),
    limit: int = Query(5, ge=1, le=LIMIT_MAX),
    exclude_task_id: Optional[str] = Query(None, alias="excludeTaskId"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _recall_on(db, current_user, folder)
    if len(q) > QUERY_MAX:
        raise _bad_query()
    try:
        result = await search(
            db,
            current_user["user_id"],
            project,
            q,
            wide=scope == "all",
            limit=limit,
            exclude_task_id=exclude_task_id,
        )
    except BadQuery:
        raise _bad_query()
    await db.commit()
    return {
        "results": [
            {**_hit_fields(hit), "completed": hit.completed, "snippets": hit.snippets}
            for hit in result.hits
        ],
        "tooBroad": result.too_broad,
    }


@router.get("/sessions/{session_id}")
async def recall_session(
    session_id: str,
    folder: Folder = Depends(),
    part: Literal["summary", "conversation"] = Query("summary"),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _recall_on(db, current_user, folder)
    page = await read(db, current_user["user_id"], project, session_id, part, offset)
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await db.commit()
    return {
        **_hit_fields(page.hit),
        "part": page.part,
        "text": page.text,
        "nextOffset": page.next_offset,
    }
