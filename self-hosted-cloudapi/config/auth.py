"""Auth-related configuration helpers."""

from config.settings import settings


def get_authentik_authorize_url() -> str:
    """Get the Authentik authorization endpoint URL."""
    return f"{settings.authentik_base_url}/application/o/authorize/"


def get_authentik_token_url() -> str:
    """Get the Authentik token endpoint URL."""
    return f"{settings.authentik_base_url}/application/o/token/"


def get_authentik_userinfo_url() -> str:
    """Get the Authentik userinfo endpoint URL."""
    return f"{settings.authentik_base_url}/application/o/userinfo/"


def get_authentik_issuer_url() -> str:
    """Get the Authentik issuer URL."""
    return f"{settings.authentik_base_url}/application/o/{settings.authentik_app_slug}/"


def get_authentik_end_session_url() -> str:
    """Get the Authentik end-session (logout) endpoint URL."""
    return f"{settings.authentik_base_url}/application/o/{settings.authentik_app_slug}/end-session/"


def get_authentik_jwks_url() -> str:
    """Get the Authentik JWKS endpoint URL."""
    return f"{settings.authentik_base_url}/application/o/{settings.authentik_app_slug}/jwks/"


def get_authentik_discovery_url() -> str:
    """Get the Authentik OpenID discovery document URL."""
    return f"{settings.authentik_base_url}/application/o/{settings.authentik_app_slug}/.well-known/openid-configuration"
