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
    create_session_and_token,
)
from src.auth.jwt_issuer import issue_session_token
from src.auth.clerk_facade import (
    format_sign_in_response,
    format_session_token_response,
    format_me_response,
    format_org_memberships_response,
)
from src.services.user_service import get_user_by_id, get_user_memberships

router = APIRouter(prefix="/v1", tags=["auth"])


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

    # Create a new client token for this session
    _, raw_token = await create_session_and_token(db, session.user_id)

    body, auth_header_value = format_sign_in_response(session.id, raw_token)

    response = JSONResponse(content=body)
    response.headers["Authorization"] = auth_header_value
    return response


@router.post("/client/sessions/{session_id}/tokens")
async def create_session_token(
    session_id: str,
    request: Request,
    is_native: str = Form("1", alias="_is_native"),
    organization_id: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible session token creation.

    Accepts form-urlencoded: _is_native=1&organization_id={orgId}
    Header: Authorization: Bearer {clientToken}
    Returns: { jwt: "..." }
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    raw_token = auth_header[7:]
    session = await validate_client_token(db, raw_token)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client token",
        )

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

    jwt_token = issue_session_token(user.id, org_id, expires_in=60)
    return format_session_token_response(jwt_token)


@router.get("/me")
async def get_me(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible user profile endpoint.

    Header: Authorization: Bearer {clientToken}
    Returns: { response: { id, first_name, last_name, image_url, ... } }
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    raw_token = auth_header[7:]
    session = await validate_client_token(db, raw_token)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client token",
        )

    user = await get_user_by_id(db, session.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return format_me_response(user, email=user.email)


@router.get("/me/organization_memberships")
async def get_organization_memberships(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible org memberships endpoint.

    Header: Authorization: Bearer {clientToken}
    Returns: { response: [{ id, role, organization: { id, name, slug, ... } }] }
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    raw_token = auth_header[7:]
    session = await validate_client_token(db, raw_token)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client token",
        )

    memberships = await get_user_memberships(db, session.user_id)
    return format_org_memberships_response(memberships)


@router.post("/client/sessions/{session_id}/remove")
async def remove_session(
    session_id: str,
    request: Request,
    is_native: str = Form("1", alias="_is_native"),
    db: AsyncSession = Depends(get_db),
):
    """Clerk-compatible logout endpoint.

    Accepts form-urlencoded: _is_native=1
    Header: Authorization: Bearer {clientToken}
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    raw_token = auth_header[7:]
    session = await validate_client_token(db, raw_token)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client token",
        )

    await deactivate_session(db, session_id)
    return {"response": "Session removed"}
