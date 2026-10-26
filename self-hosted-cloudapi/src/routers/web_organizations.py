"""Organizations (/app/organizations): create one, manage its members, leave it.

Reached from the Settings page and highlighted under its tab: the top bar has
no room for another tab on a phone.

The rules live in services/organizations; this router maps them to pages. An
organization the reader is not a member of answers the same 404 as an unknown
one. A refused change redirects back with an error code, never with free text,
so nothing a request carries is reflected into the page.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse

from src.models.organization import Membership
from src.routers.web_page import WebPage, not_found_page, render_page, require_web_page
from src.services.organizations import (
    NAME_MAX,
    ROLE_ADMIN,
    ROLES,
    OrganizationError,
    add_member,
    create_organization,
    member_counts,
    members_of,
    membership_of,
    remove_member,
    set_role,
)
from src.services.user_service import get_user_memberships

router = APIRouter(tags=["web"])

ERROR_MESSAGES = {
    "bad_name": f"An organization needs a name of at most {NAME_MAX} characters.",
    "bad_role": "Unknown role.",
    "unknown_email": "Nobody with that e-mail address has signed in yet. Ask them to sign in once, then add them.",
    "ambiguous_email": "Several accounts use that e-mail address; ask the server's administrator to merge them.",
    "already_member": "That person is already a member.",
    "not_member": "That person is not a member.",
    "last_admin": "An organization must keep at least one admin. Make someone else an admin first.",
}

ROLE_LABELS = {ROLE_ADMIN: "Admin", "org:member": "Member"}


@router.get("/app/organizations", response_class=HTMLResponse)
async def organizations_page(
    request: Request,
    error: str = Query(""),
    web: WebPage = Depends(require_web_page),
):
    memberships = await get_user_memberships(web["db"], web["user"]["user_id"])
    counts = await member_counts(web["db"], [m.organization_id for m in memberships])
    return render_page(
        request,
        web,
        "organizations.html",
        "settings",
        memberships=sorted(memberships, key=lambda m: m.organization.name.lower()),
        counts=counts,
        role_labels=ROLE_LABELS,
        error=ERROR_MESSAGES.get(error),
        name_max=NAME_MAX,
    )


@router.post("/app/organizations")
async def create_organization_action(
    request: Request,
    web: WebPage = Depends(require_web_page),
):
    form = await request.form()
    try:
        organization = await create_organization(
            web["db"], web["user"]["user_id"], str(form.get("name", ""))
        )
    except OrganizationError as error:
        return _back("/app/organizations", error)
    await web["db"].commit()
    return RedirectResponse(f"/app/organizations/{organization.id}", status_code=303)


@router.get("/app/organizations/{org_id}", response_class=HTMLResponse)
async def organization_page(
    request: Request,
    org_id: str,
    error: str = Query(""),
    web: WebPage = Depends(require_web_page),
):
    mine = await membership_of(web["db"], org_id, web["user"]["user_id"])
    if mine is None:
        return _not_found(request, web)
    return render_page(
        request,
        web,
        "organization_detail.html",
        "settings",
        organization=mine.organization,
        mine=mine,
        is_admin=mine.role == ROLE_ADMIN,
        members=await members_of(web["db"], org_id),
        roles=ROLES,
        role_labels=ROLE_LABELS,
        error=ERROR_MESSAGES.get(error),
    )


@router.post("/app/organizations/{org_id}/members")
async def add_member_action(
    request: Request,
    org_id: str,
    web: WebPage = Depends(require_web_page),
):
    await _require_admin(web, org_id)
    form = await request.form()
    try:
        await add_member(
            web["db"], org_id, str(form.get("email", "")), str(form.get("role", ""))
        )
    except OrganizationError as error:
        return _back(f"/app/organizations/{org_id}", error)
    await web["db"].commit()
    return RedirectResponse(f"/app/organizations/{org_id}", status_code=303)


@router.post("/app/organizations/{org_id}/members/{user_id}/role")
async def set_role_action(
    request: Request,
    org_id: str,
    user_id: str,
    web: WebPage = Depends(require_web_page),
):
    await _require_admin(web, org_id)
    form = await request.form()
    try:
        await set_role(web["db"], org_id, user_id, str(form.get("role", "")))
    except OrganizationError as error:
        return _back(f"/app/organizations/{org_id}", error)
    await web["db"].commit()
    return RedirectResponse(f"/app/organizations/{org_id}", status_code=303)


@router.post("/app/organizations/{org_id}/members/{user_id}/remove")
async def remove_member_action(
    org_id: str,
    user_id: str,
    web: WebPage = Depends(require_web_page),
):
    """Remove a member (admins) or leave (anyone, for themselves)."""
    leaving = user_id == web["user"]["user_id"]
    if leaving:
        await _require_member(web, org_id)
    else:
        await _require_admin(web, org_id)
    try:
        await remove_member(web["db"], org_id, user_id)
    except OrganizationError as error:
        return _back(f"/app/organizations/{org_id}", error)
    await web["db"].commit()
    target = "/app/organizations" if leaving else f"/app/organizations/{org_id}"
    return RedirectResponse(target, status_code=303)


async def _require_member(web: WebPage, org_id: str) -> Membership:
    mine = await membership_of(web["db"], org_id, web["user"]["user_id"])
    if mine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return mine


async def _require_admin(web: WebPage, org_id: str) -> None:
    if (await _require_member(web, org_id)).role != ROLE_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)


def _back(url: str, error: OrganizationError) -> RedirectResponse:
    return RedirectResponse(f"{url}?error={error.code}", status_code=303)


def _not_found(request: Request, web: WebPage) -> HTMLResponse:
    return not_found_page(
        request,
        web["user"],
        heading="Organization not found",
        hint="It does not exist, or you are not one of its members.",
        back_href="/app/organizations",
        back_label="Back to your organizations",
    )
