"""Projects (/app/projects): each space's projects, their recall scope, merging.

Reached from the Settings page and highlighted under its tab, like the
organizations pages. The rules live in services/projects. A project the reader
may not manage answers the same 404 as an unknown one; a refused change
redirects back with an error code, never with free text.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse

from src.models.project import Project
from src.routers.web_page import WebPage, render_page, require_web_page
from src.services.projects import (
    NAME_MAX,
    ProjectError,
    manageable_project,
    merge_project,
    tenants_for,
    update_project,
)

router = APIRouter(tags=["web"])

ERROR_MESSAGES = {
    "bad_name": f"A project needs a name of at most {NAME_MAX} characters.",
    "bad_scope": "That recall choice is not available for this project.",
    "bad_merge": "A project can only be merged into another project of the same space.",
}


@router.get("/app/projects", response_class=HTMLResponse)
async def projects_page(
    request: Request,
    error: str = Query(""),
    web: WebPage = Depends(require_web_page),
):
    return render_page(
        request,
        web,
        "projects.html",
        "settings",
        tenants=await tenants_for(web["db"], web["user"]["user_id"]),
        error=ERROR_MESSAGES.get(error),
        name_max=NAME_MAX,
    )


@router.post("/app/projects/{project_id}")
async def update_project_action(
    request: Request,
    project_id: str,
    web: WebPage = Depends(require_web_page),
):
    project = await _manageable(web, project_id)
    form = await request.form()
    try:
        await update_project(
            web["db"], project, str(form.get("name", "")), str(form.get("scope", ""))
        )
    except ProjectError as error:
        return _back(error)
    await web["db"].commit()
    return RedirectResponse("/app/projects", status_code=303)


@router.post("/app/projects/{project_id}/merge")
async def merge_project_action(
    request: Request,
    project_id: str,
    web: WebPage = Depends(require_web_page),
):
    source = await _manageable(web, project_id)
    form = await request.form()
    target = await _manageable(web, str(form.get("into", "")))
    try:
        await merge_project(web["db"], source, target)
    except ProjectError as error:
        return _back(error)
    await web["db"].commit()
    return RedirectResponse("/app/projects", status_code=303)


async def _manageable(web: WebPage, project_id: str) -> Project:
    project = await manageable_project(web["db"], web["user"]["user_id"], project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return project


def _back(error: ProjectError) -> RedirectResponse:
    return RedirectResponse(f"/app/projects?error={error.code}", status_code=303)
