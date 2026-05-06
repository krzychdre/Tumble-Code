"""Static token validation for ROO_CODE_CLOUD_TOKEN."""

from typing import Optional, Dict, Any

from src.auth.jwt_issuer import decode_token


def validate_static_token(token: str) -> Optional[Dict[str, Any]]:
    """Validate a static token (ROO_CODE_CLOUD_TOKEN).

    Static tokens are long-lived JWTs issued for agent/CI use cases.
    They contain the same JWTPayload structure as session tokens.

    Returns a dict with user_id, org_id, token_type if valid, None otherwise.
    """
    payload = decode_token(token)
    if payload is None:
        return None

    # Validate the issuer
    if payload.get("iss") != "rcc":
        return None

    # Validate version
    if payload.get("v") != 1:
        return None

    # Extract user info from the r claim
    r_claim = payload.get("r", {})
    user_id = r_claim.get("u") or payload.get("sub")
    org_id = r_claim.get("o")
    token_type = r_claim.get("t", "auth")

    if not user_id:
        return None

    return {
        "user_id": user_id,
        "org_id": org_id,
        "token_type": token_type,
    }
