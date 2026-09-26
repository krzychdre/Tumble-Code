"""Clerk-compatible JWT issuance and validation."""

import time
from typing import Optional, Dict, Any

import jwt

from config.settings import settings


def get_jwt_key() -> str:
    """Get the signing key based on the configured algorithm."""
    if settings.jwt_algorithm == "RS256":
        return settings.jwt_private_key or settings.jwt_secret
    return settings.jwt_secret or settings.jwt_private_key


def get_jwt_verify_key() -> str:
    """Get the verification key based on the configured algorithm."""
    if settings.jwt_algorithm == "RS256":
        return settings.jwt_public_key or settings.jwt_secret
    return settings.jwt_secret or settings.jwt_public_key


def issue_session_token(
    user_id: str,
    org_id: Optional[str] = None,
    expires_in: int = 60,
) -> str:
    """Issue a Clerk-compatible session JWT.

    The JWT payload matches the JWTPayload interface the client expects:
    - iss: "rcc"
    - sub: user_id
    - v: 1
    - r.u: user_id
    - r.o: org_id (absent if None)
    - r.t: "auth"
    """
    now = int(time.time())
    claims: Dict[str, Any] = {
        "iss": "rcc",
        "sub": user_id,
        "exp": now + expires_in,
        "iat": now,
        "nbf": now,
        "v": 1,
        "r": {
            "u": user_id,
            "t": "auth",
        },
    }
    # Only include org_id if it exists (absent when None, matching Clerk behavior)
    if org_id is not None:
        claims["r"]["o"] = org_id

    return jwt.encode(
        payload=claims,
        key=get_jwt_key(),
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate a JWT token. Returns None if invalid."""
    try:
        payload = jwt.decode(
            jwt=token,
            key=get_jwt_verify_key(),
            algorithms=[settings.jwt_algorithm],
        )
        return payload
    except jwt.PyJWTError:
        return None
