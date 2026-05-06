"""Browser auth flow router.

Implements the browser-based authentication routes:
- GET /extension/sign-in
- GET /extension/provider-sign-up
- GET /l/{slug}
- GET /auth/clerk/callback
"""

import secrets
from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.auth.authentik import generate_pkce_pair, get_authorize_url
from src.services.auth_service import (
    store_oauth_state,
    get_oauth_state,
    get_or_create_user,
    create_session_and_token,
    create_ticket,
)
from src.auth.authentik import exchange_code_for_tokens, get_userinfo
from config.settings import settings

router = APIRouter(tags=["browser-auth"])


@router.get("/extension/sign-in")
async def sign_in_page(
    state: str = Query(...),
    auth_redirect: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Authentik OAuth authorize URL for sign-in."""
    code_verifier, code_challenge = generate_pkce_pair()

    # Store state and PKCE verifier
    await store_oauth_state(db, state, auth_redirect, code_verifier)

    # Build and redirect to Authentik authorize URL
    authorize_url = get_authorize_url(state=state, code_challenge=code_challenge, auth_redirect=auth_redirect)
    return RedirectResponse(url=authorize_url)


@router.get("/extension/provider-sign-up")
async def provider_sign_up_page(
    state: str = Query(...),
    auth_redirect: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Authentik OAuth authorize URL for sign-up."""
    # Same flow as sign-in but with a different screen_hint parameter
    code_verifier, code_challenge = generate_pkce_pair()

    await store_oauth_state(db, state, auth_redirect, code_verifier)

    authorize_url = get_authorize_url(state=state, code_challenge=code_challenge, auth_redirect=auth_redirect)
    # Add screen_hint for registration
    authorize_url += "&screen_hint=signup"
    return RedirectResponse(url=authorize_url)


@router.get("/l/{slug}")
async def landing_page(
    slug: str,
    state: str = Query(...),
    auth_redirect: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Authentik OAuth authorize URL for landing page flow."""
    code_verifier, code_challenge = generate_pkce_pair()

    await store_oauth_state(db, state, auth_redirect, code_verifier)

    authorize_url = get_authorize_url(state=state, code_challenge=code_challenge, auth_redirect=auth_redirect)
    return RedirectResponse(url=authorize_url)


@router.get("/auth/clerk/callback")
async def auth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Authentik OAuth callback.

    Exchange code for tokens, create user/session, generate ticket,
    redirect to auth_redirect URI.
    """
    # Retrieve stored state
    state_store = await get_oauth_state(db, state)
    if state_store is None:
        return RedirectResponse(url="/auth/error?reason=invalid_state")

    # Exchange authorization code for tokens
    try:
        tokens = await exchange_code_for_tokens(code, state_store.code_verifier)
    except Exception:
        return RedirectResponse(url="/auth/error?reason=token_exchange_failed")

    access_token = tokens.get("access_token", "")
    id_token = tokens.get("id_token", "")

    # Get user info from Authentik
    try:
        userinfo = await get_userinfo(access_token)
    except Exception:
        return RedirectResponse(url="/auth/error?reason=userinfo_failed")

    # Extract user details from Authentik userinfo
    authentik_id = userinfo.get("sub", "")
    email = userinfo.get("email", "")
    name = userinfo.get("name", "")
    first_name = userinfo.get("given_name", name.split(" ")[0] if name else "")
    last_name = userinfo.get("family_name", name.split(" ")[-1] if name and len(name.split()) > 1 else "")
    picture = userinfo.get("picture", "")

    # Create or update user
    user = await get_or_create_user(
        db=db,
        authentik_id=authentik_id,
        email=email,
        first_name=first_name,
        last_name=last_name,
        image_url=picture,
    )

    # Create session and client token
    session, raw_token = await create_session_and_token(db, user.id)

    # Generate ticket for Clerk sign-in flow
    ticket_code = await create_ticket(db, session.id)

    # Determine organization ID (from Authentik groups or default)
    org_id = None  # TODO: Map Authentik groups to organizations

    # Build redirect URL back to VS Code
    # The VS Code extension's handleUri() routes on the URI path,
    # specifically matching "/auth/clerk/callback". The auth_redirect
    # parameter from the extension is just the base URI scheme
    # (e.g. "vscode://RooVeterinaryInc.roo-cline"), so we must
    # append the callback path before adding query parameters.
    redirect_url = state_store.auth_redirect
    callback_path = "/auth/clerk/callback"
    separator = "&" if "?" in redirect_url else "?"
    params = f"code={ticket_code}&state={state}"
    if org_id:
        params += f"&organizationId={org_id}"

    return RedirectResponse(url=f"{redirect_url}{callback_path}{separator}{params}")
