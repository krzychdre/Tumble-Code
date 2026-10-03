"""The shared preamble of every web-panel page.

Every /app endpoint starts the same way: resolve the signed-in browser user
(redirect to /app/login when there is none) and open a database session, and
every HTML page ends the same way: a TemplateResponse whose context carries
the user and the highlighted nav tab. ``require_web_page`` and
``render_page`` write those once, so a new page states its template and its
nav tab instead of re-typing the rest. ``not_found_page`` is the one 404 an
/app page answers for an unknown or someone else's thing: unknown and
foreign were deliberately indistinguishable before, and must stay so.
"""

from typing import Optional, TypedDict

from fastapi import Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser, require_web_user
from src.database import get_db
from src.web.templating import templates


class WebPage(TypedDict):
    """What every /app page handler starts with: who is asking, and the
    database session to answer with."""

    user: WebUser
    db: AsyncSession


async def require_web_page(
    user: WebUser = Depends(require_web_user),
    db: AsyncSession = Depends(get_db),
) -> WebPage:
    """The signed-in user plus the page's database session, in one dependency.

    Built on ``require_web_user``, which is built on ``get_web_user_optional``:
    overriding either of those in tests signs a reader in here too, exactly as
    before.
    """
    return WebPage(user=user, db=db)


def render_page(
    request: Request,
    page: WebPage,
    template_name: str,
    nav_active: str,
    /,
    **context,
) -> HTMLResponse:
    """Render an /app page: the user and the highlighted nav tab plus whatever
    the page itself has to say."""
    return templates.TemplateResponse(
        request,
        template_name,
        {"user": page["user"], "nav_active": nav_active, **context},
    )


def not_found_page(
    request: Request,
    user: Optional[WebUser],
    /,
    heading: str = "",
    hint: str = "",
    back_href: str = "/app",
    back_label: str = "Back to your tasks",
) -> HTMLResponse:
    """The 404 an /app page answers for a thing that is unknown or someone
    else's - the same response either way, so the page discloses nothing
    about what else exists.

    Every argument has the template's own default (``not_found.html``), so a
    plain unknown-task 404 needs none of them and a page with its own wording
    states it explicitly.
    """
    return templates.TemplateResponse(
        request,
        "not_found.html",
        {
            "user": user,
            "heading": heading,
            "hint": hint,
            "back_href": back_href,
            "back_label": back_label,
        },
        status_code=404,
    )
