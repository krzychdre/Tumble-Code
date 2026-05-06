"""Bridge service for WebSocket bridge config."""

from config.settings import settings
from src.auth.jwt_issuer import issue_session_token


async def get_bridge_config(user_id: str, org_id: str = None):
    """Get bridge/websocket configuration."""
    token = issue_session_token(user_id, org_id, expires_in=300)

    return {
        "userId": user_id,
        "socketBridgeUrl": f"ws://localhost:8080/ws" if settings.bridge_enabled else "",
        "token": token,
    }
