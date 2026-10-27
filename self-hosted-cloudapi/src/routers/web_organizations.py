"""Organizations (/app/organizations): the reader's organizations and members.

Read-only: organizations and memberships come from Authentik groups
(services/organizations), and the pages link to Authentik's admin panel where
they are managed. An organization the reader is not a member of answers the
same 404 as an unknown one.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from config.auth import front_channel
from src.routers.web_page import WebPage, not_found_page, render_page, require_web_page
from src.services.organizations import (
    ROLE_ADMIN,
    ROLE_MEMBER,
    member_counts,
    members_of,
    membership_of,
)
from src.services.user_service import get_user_memberships

router = APIRouter(tags=["web"])

ROLE_LABELS = {ROLE_ADMIN: "Admin", ROLE_MEMBER: "Member"}


def _authentik_groups_url(request: Request) -> str:
    """Authentik's admin page for groups, on the host this browser can reach."""
    base = front_channel(request.headers.get("host")).authentik_base
    return f"{base}/if/admin/#/identity/groups"


@router.get("/app/organizations", response_class=HTMLResponse)
async def organizations_page(
    request: Request,
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
        authentik_groups_url=_authentik_groups_url(request),
    )


@router.get("/app/organizations/{org_id}", response_class=HTMLResponse)
async def organization_page(
    request: Request,
    org_id: str,
    web: WebPage = Depends(require_web_page),
):
    mine = await membership_of(web["db"], org_id, web["user"]["user_id"])
    if mine is None:
        return not_found_page(
            request,
            web["user"],
            heading="Organization not found",
            hint="It does not exist, or you are not one of its members.",
            back_href="/app/organizations",
            back_label="Back to your organizations",
        )
    return render_page(
        request,
        web,
        "organization_detail.html",
        "settings",
        organization=mine.organization,
        members=await members_of(web["db"], org_id),
        role_labels=ROLE_LABELS,
        authentik_groups_url=_authentik_groups_url(request),
    )
