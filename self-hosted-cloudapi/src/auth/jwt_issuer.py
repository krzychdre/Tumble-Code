"""Clerk-compatible JWT issuance and validation."""

import time
from typing import Optional, Dict, Any

import jwt

from config.settings import settings


# Every token this server issues carries these two claims: issue_session_token
# below, and the long-lived static tokens (ROO_CODE_CLOUD_TOKEN) the retired
# issue_static_token handed out, have stamped them since this file was written.
TOKEN_ISSUER = "rcc"
TOKEN_VERSION = 1


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
        "iss": TOKEN_ISSUER,
        "sub": user_id,
        "exp": now + expires_in,
        "iat": now,
        "nbf": now,
        "v": TOKEN_VERSION,
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
    """Decode and validate a JWT this server issued. Returns None if invalid.

    Besides the signature, algorithm and time claims, the token must name our
    issuer (``iss == "rcc"``) and payload version (``v == 1``, an integer): a
    token signed with our key but lacking either was not issued by this server
    and is refused. This is the one check both the extension API
    (dependencies.get_current_user) and the bridge handshake
    (realtime.sio._user_id_from_token) rely on.
    """
    try:
        payload = jwt.decode(
            jwt=token,
            key=get_jwt_verify_key(),
            algorithms=[settings.jwt_algorithm],
            issuer=TOKEN_ISSUER,
            options={"require": ["iss"]},
        )
    except jwt.PyJWTError:
        return None
    version = payload.get("v")
    # type() rather than isinstance(): JSON true decodes to True, which is an int.
    if type(version) is not int or version != TOKEN_VERSION:
        return None
    return payload
