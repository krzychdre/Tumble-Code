"""Browser auth flow router.

Implements the browser-based authentication routes:
- GET /extension/sign-in
- GET /extension/provider-sign-up
- GET /l/{slug}
- GET /auth/clerk/callback
- GET /auth/error
"""

import logging
import secrets
import html
import urllib.parse
from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.auth.authentik import generate_pkce_pair, get_authorize_url
from src.auth.web_session import set_session_cookie, clear_session_cookie
from src.services.auth_service import (
    store_oauth_state,
    get_oauth_state,
    get_or_create_user,
    create_session,
    create_ticket,
)
from src.auth.authentik import exchange_code_for_tokens, get_userinfo
from config.settings import settings

# Marker stored as the OAuth `auth_redirect` for browser (web) logins. The
# shared /auth/clerk/callback branches on this: web logins set a session cookie
# and redirect to /app; everything else does the vscode:// bounce.
WEB_AUTH_REDIRECT = "web:/app"

logger = logging.getLogger(__name__)

router = APIRouter(tags=["browser-auth"])


def _auth_success_html(redirect_url: str) -> str:
    """Render an HTML page that navigates to a vscode:// URI.

    Browsers often block HTTP 307 redirects to custom protocol URIs, so we
    return an HTML page that uses JavaScript + a fallback link instead.
    """
    escaped_url = html.escape(redirect_url, quote=True)
    # For JS: escape backslashes, single-quotes, and closing-script tags
    js_safe_url = redirect_url.replace("\\", "\\\\").replace("'", "\\x27").replace("</", "<\\/")

    parts = [
        "<!DOCTYPE html>",
        "<html lang='en'>",
        "<head>",
        "<meta charset='utf-8'>",
        "<title>Roo Code - Authentication Successful</title>",
        "<style>",
        "  body {",
        "    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
        "    display: flex; justify-content: center; align-items: center;",
        "    min-height: 100vh; margin: 0; background: #1e1e1e; color: #ccc;",
        "  }",
        "  .container {",
        "    text-align: center; padding: 2rem; max-width: 480px;",
        "    background: #2d2d2d; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.4);",
        "  }",
        "  .check { font-size: 3rem; margin-bottom: 0.5rem; }",
        "  h1 { color: #4ec9b0; margin: 0 0 0.5rem; font-size: 1.4rem; }",
        "  p { color: #999; margin: 0 0 1.5rem; line-height: 1.5; }",
        "  a {",
        "    display: inline-block; padding: 0.6rem 1.4rem;",
        "    background: #0078d4; color: #fff; text-decoration: none;",
        "    border-radius: 6px; font-weight: 600;",
        "  }",
        "  a:hover { background: #1a8ae8; }",
        "</style>",
        "</head>",
        "<body>",
        "<div class='container'>",
        "  <div class='check'>&#10003;</div>",
        "  <h1>Authentication Successful</h1>",
        "  <p>You have successfully signed in to Roo Code.<br>Returning to VS Code...</p>",
        f"  <a href='{escaped_url}'>Return to VS Code manually</a>",
        "</div>",
        "<script>",
        "  // Attempt automatic navigation to the custom-protocol URI.",
        "  // Some browsers ignore window.location for custom schemes;",
        "  // the clickable link above serves as a fallback.",
        "  try {",
        f"    window.location.assign('{js_safe_url}');",
        "  } catch(e) {",
        "    // Fallback: user can click the link manually.",
        "  }",
        "</script>",
        "</body>",
        "</html>",
    ]
    return "\n".join(parts)


def _auth_error_html(reason: str, detail: str = "") -> str:
    """Render an HTML error page for authentication failures."""
    escaped_reason = html.escape(reason, quote=True)
    escaped_detail = html.escape(detail, quote=True) if detail else ""

    parts = [
        "<!DOCTYPE html>",
        "<html lang='en'>",
        "<head>",
        "<meta charset='utf-8'>",
        "<title>Roo Code - Authentication Error</title>",
        "<style>",
        "  body {",
        "    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
        "    display: flex; justify-content: center; align-items: center;",
        "    min-height: 100vh; margin: 0; background: #1e1e1e; color: #ccc;",
        "  }",
        "  .container {",
        "    text-align: center; padding: 2rem; max-width: 480px;",
        "    background: #2d2d2d; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.4);",
        "  }",
        "  .cross { font-size: 3rem; margin-bottom: 0.5rem; color: #f44747; }",
        "  h1 { color: #f44747; margin: 0 0 0.5rem; font-size: 1.4rem; }",
        "  p { color: #999; margin: 0 0 0.5rem; line-height: 1.5; }",
        "  .detail { color: #777; font-size: 0.85rem; }",
        "  a {",
        "    display: inline-block; padding: 0.6rem 1.4rem; margin-top: 1rem;",
        "    background: #444; color: #ccc; text-decoration: none;",
        "    border-radius: 6px; font-weight: 600;",
        "  }",
        "  a:hover { background: #555; }",
        "</style>",
        "</head>",
        "<body>",
        "<div class='container'>",
        "  <div class='cross'>&#10007;</div>",
        "  <h1>Authentication Failed</h1>",
        f"  <p>{escaped_reason}</p>",
        f"  <p class='detail'>{escaped_detail}</p>",
        "  <a href='javascript:window.close()'>Close this tab</a>",
        "</div>",
        "</body>",
        "</html>",
    ]
    return "\n".join(parts)


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


@router.get("/app/login")
async def web_login(
    db: AsyncSession = Depends(get_db),
):
    """Start the Authentik OAuth flow for a browser (web viewer) login.

    Uses the same redirect URI as the extension flow; the callback distinguishes
    web logins via the WEB_AUTH_REDIRECT marker stored in the OAuth state.
    """
    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = generate_pkce_pair()
    await store_oauth_state(db, state, WEB_AUTH_REDIRECT, code_verifier)
    authorize_url = get_authorize_url(
        state=state, code_challenge=code_challenge, auth_redirect=WEB_AUTH_REDIRECT
    )
    return RedirectResponse(url=authorize_url)


@router.get("/app/logout")
async def web_logout():
    """Clear the browser session cookie and return to the login page."""
    response = RedirectResponse(url="/app/login", status_code=303)
    clear_session_cookie(response)
    return response


@router.get("/auth/clerk/callback")
async def auth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Authentik OAuth callback.

    Exchange code for tokens, create user/session, generate ticket,
    then render an HTML page that navigates back to VS Code via the
    vscode:// custom-protocol URI.

    Why HTML instead of HTTP 307 redirect?
    ---------------------------------------
    Many browsers (especially Chromium-based) block HTTP 3xx redirects
    to custom-protocol URIs (e.g. vscode://).  Returning an HTML page
    with window.location.assign() and a manual fallback link is the
    standard technique used by OAuth providers (Clerk, Auth0, etc.).
    """
    # Retrieve stored state
    state_store = await get_oauth_state(db, state)
    if state_store is None:
        logger.warning("Auth callback received with invalid or expired state: %s", state[:8] if state else "empty")
        return HTMLResponse(
            content=_auth_error_html(
                "Invalid or expired authentication state.",
                "The authentication session may have timed out. Please try signing in again.",
            ),
            status_code=400,
        )

    # Exchange authorization code for tokens
    try:
        tokens = await exchange_code_for_tokens(code, state_store.code_verifier)
    except Exception as e:
        logger.error("Token exchange failed: %s", e)
        return HTMLResponse(
            content=_auth_error_html(
                "Token exchange failed.",
                "The authorization code could not be exchanged for tokens. Please try again.",
            ),
            status_code=502,
        )

    access_token = tokens.get("access_token", "")

    # Get user info from Authentik
    try:
        userinfo = await get_userinfo(access_token)
    except Exception as e:
        logger.error("Userinfo fetch failed: %s", e)
        return HTMLResponse(
            content=_auth_error_html(
                "Failed to retrieve user information.",
                "The user info endpoint returned an error. Please try again.",
            ),
            status_code=502,
        )

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

    # Create only the session here. The client token is minted later, at
    # POST /v1/client/sign_ins, so the raw token can be handed back to the
    # extension in the same request (the DB only stores its hash, so a token
    # created here would be unrecoverable).
    session = await create_session(db, user.id)

    # Browser (web viewer) login: set a signed session cookie and redirect to
    # the task list instead of bouncing back to VS Code.
    if state_store.auth_redirect == WEB_AUTH_REDIRECT:
        logger.info(
            "Web auth callback successful for user %s (email=%s)",
            authentik_id[:8] if authentik_id else "unknown",
            email,
        )
        response = RedirectResponse(url="/app", status_code=303)
        set_session_cookie(response, session_id=session.id, user_id=user.id)
        return response

    # Generate ticket for Clerk sign-in flow
    ticket_code = await create_ticket(db, session.id)

    # Determine organization ID (from Authentik groups or default)
    org_id = None  # TODO: Map Authentik groups to organizations

    # Build redirect URL back to VS Code
    # ------------------------------------
    # The VS Code extension's handleUri() routes on the URI path,
    # specifically matching "/auth/clerk/callback". The auth_redirect
    # parameter from the extension is just the base URI scheme
    # (e.g. "vscode://RooVeterinaryInc.roo-cline"), so we must
    # append the callback path before adding query parameters.
    #
    # IMPORTANT: Query parameter values must be URL-encoded so that
    # special characters in the ticket code or state (e.g. +, =, /)
    # do not corrupt the URI parsing in VS Code.
    redirect_url = state_store.auth_redirect
    callback_path = "/auth/clerk/callback"
    params = urllib.parse.urlencode({
        "code": ticket_code,
        "state": state,
    })
    if org_id:
        params += "&organizationId=" + urllib.parse.quote(str(org_id))

    vscode_uri = redirect_url + callback_path + "?" + params

    logger.info(
        "Auth callback successful for user %s (email=%s), redirecting to VS Code",
        authentik_id[:8] if authentik_id else "unknown",
        email,
    )

    return HTMLResponse(content=_auth_success_html(vscode_uri))


@router.get("/auth/error")
async def auth_error_page(
    reason: str = Query("unknown"),
):
    """Display an authentication error page."""
    reasons = {
        "invalid_state": "Invalid or expired authentication state.",
        "token_exchange_failed": "Token exchange failed.",
        "userinfo_failed": "Failed to retrieve user information.",
    }
    message = reasons.get(reason, "An unknown authentication error occurred.")
    return HTMLResponse(content=_auth_error_html(message), status_code=400)
