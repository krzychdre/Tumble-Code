"""Browser session-cookie authentication for the web task viewer.

The extension authenticates with Bearer JWTs, but a browser page needs a
cookie-based session. We mint a signed cookie after the Authentik OAuth
callback (see routers/browser.py), carrying the existing Session row id. Each
request re-validates that the Session is still active, so a cloud logoff
(/v1/client/sessions/{id}/remove, which flips Session.is_active) also
invalidates the web session.

The cookie is signed (not encrypted) with the app secret_key via itsdangerous;
it carries no secret, only the session/user ids, and is validated server-side
against the DB on every request.
"""

from typing import Optional, TypedDict

from fastapi import Depends, Request
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from config.settings import settings
from src.database import get_db
from src.models.user import Session, User

COOKIE_NAME = "tumble_session"
_SALT = "tumble-web-session"
# 30 days — the web session stays valid until it expires or the user logs off.
MAX_AGE_SECONDS = 30 * 24 * 60 * 60

_serializer = URLSafeTimedSerializer(settings.secret_key, salt=_SALT)


class WebUser(TypedDict):
    user_id: str
    session_id: str
    email: str
    name: str
    image_url: Optional[str]


def set_session_cookie(response: Response, session_id: str, user_id: str) -> None:
    """Attach a signed session cookie to a response."""
    token = _serializer.dumps({"sid": session_id, "uid": user_id})
    # secure=False so it works over http://localhost in dev. Tighten for prod.
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Remove the session cookie (logout)."""
    response.delete_cookie(key=COOKIE_NAME, path="/")


def _decode_cookie(raw: str) -> Optional[dict]:
    try:
        return _serializer.loads(raw, max_age=MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None


async def resolve_web_user(raw_cookie: Optional[str], db: AsyncSession) -> Optional[WebUser]:
    """Validate a raw signed session cookie value against the DB → WebUser | None.

    Shared by the HTTP dependency (`get_web_user_optional`) and the socket.io
    handshake, which reads the cookie from the ASGI environ rather than from a
    FastAPI Request. Returns None for missing/invalid/expired cookies,
    deactivated sessions, or a user that no longer exists.
    """
    if not raw_cookie:
        return None

    data = _decode_cookie(raw_cookie)
    if not data:
        return None

    session_id = data.get("sid")
    if not session_id:
        return None

    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.is_active == True)  # noqa: E712
    )
    session = result.scalar_one_or_none()
    if session is None:
        return None

    result = await db.execute(select(User).where(User.id == session.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return None

    name = (f"{user.first_name or ''} {user.last_name or ''}").strip() or user.email
    return WebUser(
        user_id=user.id,
        session_id=session.id,
        email=user.email,
        name=name,
        image_url=user.image_url,
    )


async def get_web_user_optional(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Optional[WebUser]:
    """Resolve the current browser user from the session cookie, or None.

    Web routes redirect to /app/login on None.
    """
    return await resolve_web_user(request.cookies.get(COOKIE_NAME), db)
