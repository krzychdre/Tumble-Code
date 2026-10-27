"""Projects (/app/projects): a filtered, paged list of the reader's projects,
and each project's own page with its recall scope and merging.

Reached from the Settings page and highlighted under its tab, like the
organizations pages. The rules live in services/projects. A project the reader
may not see answers the same 404 as an unknown one, and so do the forms of a
project the reader may not manage; a refused change redirects back to the
project's page with an error code, never with free text.
"""

from functools import partial
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse

from src.models.project import Project
from src.routers.web_page import WebPage, not_found_page, render_page, require_web_page
from src.services.projects import (
    NAME_MAX,
    ProjectError,
    manageable_project,
    merge_names,
    merge_project,
    merge_target,
    project_access,
    project_facts,
    project_list_page,
    renamed_count,
    scopes_for,
    spaces_for,
    update_project,
)

router = APIRouter(tags=["web"])

ERROR_MESSAGES = {
    "bad_name": f"A project needs a name of at most {NAME_MAX} characters.",
    "bad_scope": "That recall choice is not available for this project.",
    "bad_merge": "A project can only be merged into another project of the same space.",
    "name_taken": "Another project of this space already has that name. Choose another one.",
}


@router.get("/app/projects", response_class=HTMLResponse)
async def projects_page(
    request: Request,
    q: str = Query(""),
    space: str = Query(""),
    recall: str = Query(""),
    renamed: str = Query(""),
    page: int = Query(1),
    web: WebPage = Depends(require_web_page),
):
    q = q.strip()
    spaces = await spaces_for(web["db"], web["user"]["user_id"])
    rows, pager = await project_list_page(
        web["db"], spaces, q, space, recall, renamed, page
    )
    filters = {"q": q, "space": space, "recall": recall, "renamed": renamed}
    return render_page(
        request,
        web,
        "projects.html",
        "settings",
        rows=rows,
        spaces=spaces,
        filters=filters,
        filtered=any(filters.values()),
        renamed_count=await renamed_count(web["db"], spaces),
        page_url=partial(_list_url, filters),
        scopes_for=scopes_for,
        **pager,
    )


@router.get("/app/projects/{project_id}", response_class=HTMLResponse)
async def project_page(
    request: Request,
    project_id: str,
    error: str = Query(""),
    web: WebPage = Depends(require_web_page),
):
    access = await project_access(web["db"], web["user"]["user_id"], project_id)
    if access is None:
        return not_found_page(
            request,
            web["user"],
            heading="Project not found",
            hint="It does not exist, or it belongs to a space you are not part of.",
            back_href="/app/projects",
            back_label="Back to your projects",
        )
    task_count, folders = await project_facts(web["db"], access.project)
    return render_page(
        request,
        web,
        "project_detail.html",
        "settings",
        access=access,
        project=access.project,
        task_count=task_count,
        folders=folders,
        scopes=scopes_for(access.project),
        merge_names=await merge_names(web["db"], access.project)
        if access.can_manage
        else [],
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
        return _back(project, error)
    await web["db"].commit()
    return RedirectResponse(f"/app/projects/{project.id}", status_code=303)


@router.post("/app/projects/{project_id}/merge")
async def merge_project_action(
    request: Request,
    project_id: str,
    web: WebPage = Depends(require_web_page),
):
    source = await _manageable(web, project_id)
    form = await request.form()
    try:
        target = await merge_target(web["db"], source, str(form.get("into", "")))
        await merge_project(web["db"], source, target)
    except ProjectError as error:
        return _back(source, error)
    await web["db"].commit()
    return RedirectResponse(f"/app/projects/{target.id}", status_code=303)


async def _manageable(web: WebPage, project_id: str) -> Project:
    project = await manageable_project(web["db"], web["user"]["user_id"], project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return project


def _back(project: Project, error: ProjectError) -> RedirectResponse:
    return RedirectResponse(
        f"/app/projects/{project.id}?error={error.code}", status_code=303
    )


def _list_url(filters: dict, page: int) -> str:
    """The list's URL for ``page`` with the active filters."""
    query = urlencode({k: v for k, v in {**filters, "page": page}.items() if v})
    return f"/app/projects?{query}"
