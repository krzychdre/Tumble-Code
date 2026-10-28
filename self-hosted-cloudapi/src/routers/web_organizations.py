"""Organizations (/app/organizations): a filtered, paged list of the reader's
organizations, and each one's page with its members.

Read-only: organizations and memberships come from Authentik groups
(services/organizations), and the pages link to Authentik's admin panel where
they are managed. An organization the reader is not a member of answers the
same 404 as an unknown one.
"""

from functools import partial
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse

from config.auth import front_channel
from src.routers.web_page import WebPage, not_found_page, render_page, require_web_page
from src.services.organizations import (
    ROLE_ADMIN,
    ROLE_MEMBER,
    member_page,
    membership_of,
    organization_list_page,
)

router = APIRouter(tags=["web"])

ROLE_LABELS = {ROLE_ADMIN: "Admin", ROLE_MEMBER: "Member"}


def _authentik_groups_url(request: Request) -> str:
    """Authentik's admin page for groups, on the host this browser can reach."""
    base = front_channel(request.headers.get("host")).authentik_base
    return f"{base}/if/admin/#/identity/groups"


@router.get("/app/organizations", response_class=HTMLResponse)
async def organizations_page(
    request: Request,
    q: str = Query(""),
    page: int = Query(1),
    web: WebPage = Depends(require_web_page),
):
    q = q.strip()
    rows, pager = await organization_list_page(
        web["db"], web["user"]["user_id"], q, page
    )
    return render_page(
        request,
        web,
        "organizations.html",
        "settings",
        rows=rows,
        q=q,
        page_url=partial(_page_url, "/app/organizations", q),
        role_labels=ROLE_LABELS,
        authentik_groups_url=_authentik_groups_url(request),
        **pager,
    )


@router.get("/app/organizations/{org_id}", response_class=HTMLResponse)
async def organization_page(
    request: Request,
    org_id: str,
    page: int = Query(1),
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
    members, pager = await member_page(web["db"], org_id, page)
    return render_page(
        request,
        web,
        "organization_detail.html",
        "settings",
        organization=mine.organization,
        is_admin=mine.role == ROLE_ADMIN,
        members=members,
        page_url=partial(_page_url, f"/app/organizations/{org_id}", ""),
        role_labels=ROLE_LABELS,
        authentik_groups_url=_authentik_groups_url(request),
        **pager,
    )


def _page_url(path: str, q: str, page: int) -> str:
    """``path`` at ``page``, keeping the name filter."""
    query = urlencode({k: v for k, v in {"q": q, "page": page}.items() if v})
    return f"{path}?{query}"
