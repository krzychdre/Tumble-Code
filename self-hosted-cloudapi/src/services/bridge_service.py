"""Bridge service: config the extension needs to open the socket.io connection.

The extension fetches this from GET /api/extension/bridge/config, then connects
its socket.io client to `socketBridgeUrl` (origin) using `socketBridgePath`
(the mounted engine.io endpoint) and `token` (a short-lived session JWT) for the
handshake auth. The server validates that token to bind the socket to a user.
"""

from config.settings import settings
from src.auth.jwt_issuer import issue_session_token


async def get_bridge_config(user_id: str, org_id: str = None) -> dict:
    """Build the socket.io bridge configuration for an extension instance."""
    # Short-lived token: the extension re-fetches the config (and so a fresh
    # token) whenever it (re)connects.
    token = issue_session_token(user_id, org_id, expires_in=300)

    return {
        "userId": user_id,
        # Origin of this API; the socket.io client appends `socketBridgePath`.
        "socketBridgeUrl": settings.api_base_url,
        "socketBridgePath": settings.bridge_path,
        "token": token,
    }
