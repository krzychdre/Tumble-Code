"""Cross-session recall API for the extension (/api/recall).

The contract is section 7 of ai_plans/2026-10-26_18-22_cross-session-recall.md.
The client names its folder; the user and the tenant come from the token, and
the folder resolves to a project within them only (services/projects).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.services.projects import resolve_project

router = APIRouter(prefix="/api/recall", tags=["recall"])


@router.get("/context")
async def recall_context(
    workspace_path: str = Query(..., alias="workspacePath", min_length=1),
    repository_url: str = Query("", alias="repositoryUrl"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The folder's project and its recall scope; the tools exist unless ``none``."""
    project = await resolve_project(
        db,
        current_user["user_id"],
        current_user["org_id"],
        workspace_path,
        repository_url,
    )
    await db.commit()
    return {
        "projectId": project.id,
        "projectName": project.name,
        "scope": project.recall_scope,
    }
