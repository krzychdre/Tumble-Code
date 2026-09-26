"""Clerk-compatible auth facade router.

Implements the 5 Clerk API endpoints that the Roo Code client calls:
- POST /v1/client/sign_ins
- POST /v1/client/sessions/{session_id}/tokens
- GET /v1/me
- GET /v1/me/organization_memberships
- POST /v1/client/sessions/{session_id}/remove
"""

from fastapi import APIRouter, Request, Depends, Form, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.services.auth_service import (
    validate_ticket,
    validate_client_token,
    deactivate_session,
    create_client_token,
)
from src.auth.jwt_issuer import issue_session_token
from src.auth.clerk_facade import (
    format_sign_in_response,
    format_session_token_response,
    format_me_response,
    format_org_memberships_response,
)
from src.models.user import Session as SessionModel
from src.services.user_service import get_user_by_id, get_user_memberships, is_member_of

router = APIRouter(prefix="/v1", tags=["auth"])


async def client_session(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SessionModel:
    """The active session behind the request's ``Authorization: Bearer`` client token.

    The client token is the one POST /v1/client/sign_ins hands back; every
    other Clerk route sends it. A missing header, one not starting with
    exactly ``"Bearer "``, or a token matching no active session is a 401.
    The route shares this request's database session (FastAPI caches
    ``get_db`` per request), so it sees what this lookup saw.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    session = await validate_client_token(db, auth_header[7:])
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client token",
        )
    return session


@router.post("/client/sign_ins")
async def sign_in(
    request: Request,
    strategy: str = Form(...),
    ticket: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible sign-in endpoint.

    Accepts form-urlencoded: strategy=ticket&ticket={code}
    Returns: { response: { created_session_id: "sess_..." } }
    Header: Authorization: Bearer {clientToken}
    """
    if strategy != "ticket":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported strategy: {strategy}. Only ticket is supported.",
        )

    session = await validate_ticket(db, ticket)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired ticket",
        )

    # Bind the client token to the ticket's session — not a new one — so the
    # session id we return in the body matches the token's session, and the
    # subsequent POST /v1/client/sessions/{sess_id}/tokens call resolves.
    _, raw_token = await create_client_token(db, session.id)

    body, auth_header_value = format_sign_in_response(session.id, raw_token)

    response = JSONResponse(content=body)
    response.headers["Authorization"] = auth_header_value
    return response


@router.post("/client/sessions/{session_id}/tokens")
async def create_session_token(
    session_id: str,
    is_native: str = Form("1", alias="_is_native"),
    organization_id: str = Form(""),
    session: SessionModel = Depends(client_session),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible session token creation.

    Accepts form-urlencoded: _is_native=1&organization_id={orgId}
    Header: Authorization: Bearer {clientToken}
    Returns: { jwt: "..." }
    """
    if session.id != session_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    user = await get_user_by_id(db, session.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Determine org_id: empty string means personal account
    org_id = organization_id if organization_id else None

    # The org claim is what every org-scoped check downstream trusts, so the
    # client may only name an organization the user is a member of.
    if org_id is not None and not await is_member_of(db, user.id, org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )

    jwt_token = issue_session_token(user.id, org_id, expires_in=60)
    return format_session_token_response(jwt_token)


@router.get("/me")
async def get_me(
    session: SessionModel = Depends(client_session),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible user profile endpoint.

    Header: Authorization: Bearer {clientToken}
    Returns: { response: { id, first_name, last_name, image_url, ... } }
    """
    user = await get_user_by_id(db, session.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return format_me_response(user, email=user.email)


@router.get("/me/organization_memberships")
async def get_organization_memberships(
    session: SessionModel = Depends(client_session),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible org memberships endpoint.

    Header: Authorization: Bearer {clientToken}
    Returns: { response: [{ id, role, organization: { id, name, slug, ... } }] }
    """
    memberships = await get_user_memberships(db, session.user_id)
    return format_org_memberships_response(memberships)


@router.post("/client/sessions/{session_id}/remove")
async def remove_session(
    session_id: str,
    is_native: str = Form("1", alias="_is_native"),
    session: SessionModel = Depends(client_session),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible logout endpoint.

    Accepts form-urlencoded: _is_native=1
    Header: Authorization: Bearer {clientToken}
    """
    # A client token may only end its own session (same answer as the sibling
    # check in create_session_token), never another user's.
    if session.id != session_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    await deactivate_session(db, session_id)
    return {"response": "Session removed"}
