"""Authentik OAuth2 client for PKCE authorization code flow."""

import hashlib
import base64
import secrets
from typing import Optional, Dict, Any
from urllib.parse import urlencode

import httpx

from config.settings import settings
from config.auth import (
    get_authentik_authorize_url,
    get_authentik_token_url,
    get_authentik_userinfo_url,
    get_authentik_end_session_url,
    get_authentik_jwks_url,
    get_authentik_discovery_url,
)


def generate_pkce_pair() -> tuple[str, str]:
    """Generate a PKCE code verifier and code challenge."""
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode().rstrip("=")
    return code_verifier, code_challenge


def get_authorize_url(
    state: str,
    code_challenge: str,
    auth_redirect: str,
) -> str:
    """Build the Authentik authorization URL for the OAuth2 flow."""
    params = {
        "client_id": settings.authentik_client_id,
        "response_type": "code",
        "redirect_uri": settings.authentik_redirect_uri,
        "scope": "openid profile email",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{get_authentik_authorize_url()}?{urlencode(params)}"


async def exchange_code_for_tokens(
    code: str,
    code_verifier: str,
) -> Dict[str, Any]:
    """Exchange an authorization code for tokens using PKCE."""
    async with httpx.AsyncClient() as client:
        token_data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.authentik_redirect_uri,
            "client_id": settings.authentik_client_id,
            "code_verifier": code_verifier,
        }
        # Include client_secret for confidential OAuth clients
        if settings.authentik_client_secret:
            token_data["client_secret"] = settings.authentik_client_secret

        response = await client.post(
            get_authentik_token_url(),
            data=token_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        return response.json()


async def get_userinfo(access_token: str) -> Dict[str, Any]:
    """Fetch user info from Authentik using the access token."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            get_authentik_userinfo_url(),
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()


async def get_openid_configuration() -> Dict[str, Any]:
    """Fetch the OpenID Connect discovery document from Authentik."""
    async with httpx.AsyncClient() as client:
        response = await client.get(get_authentik_discovery_url())
        response.raise_for_status()
        return response.json()
