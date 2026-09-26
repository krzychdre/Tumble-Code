"""FastAPI dependency injection."""

from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.auth.jwt_issuer import decode_token

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Extract and validate the current user from the Bearer token.

    Supports both session JWTs and static tokens (ROO_CODE_CLOUD_TOKEN): both
    are JWTs signed with the same key, so one decode serves both. Returns a
    dict with user_id, org_id, and token_type.

    The token is decoded once. It used to be decoded twice, first through
    ``validate_static_token`` (which also requires ``iss == "rcc"`` and
    ``v == 1``) and, when that refused, again without those checks; both paths
    built the same dict, so the issuer and version never decided the outcome.
    That is kept as found: a token signed with our key is accepted whatever
    its ``iss``/``v`` (see tests/test_route_boilerplate.py). Requiring them
    would refuse any such token a client already holds, a decision for the
    owner rather than for a refactor.

    Reads nothing from the database, so it asks for no session.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )

    payload = decode_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("r", {}).get("u") or payload.get("sub")
    org_id = payload.get("r", {}).get("o")
    token_type = payload.get("r", {}).get("t", "auth")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing user ID",
        )

    return {
        "user_id": user_id,
        "org_id": org_id,
        "token_type": token_type,
    }


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[dict]:
    """Like get_current_user but returns None instead of raising for unauthenticated requests."""
    if credentials is None:
        return None

    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
