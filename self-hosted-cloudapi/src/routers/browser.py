"""Browser auth flow router.

Implements the browser-based authentication routes:
- GET /extension/sign-in
- GET /extension/provider-sign-up
- GET /l/{slug}
- GET /auth/clerk/callback
- GET /auth/error
"""

import logging
import re
import secrets
import urllib.parse
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse, HTMLResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.auth.authentik import generate_pkce_pair, get_authorize_url
from src.auth.web_session import clear_session_cookie, cookie_should_be_secure, set_session_cookie
from src.services.auth_service import (
    store_oauth_state,
    get_oauth_state,
    get_or_create_user,
    create_session,
    create_ticket,
)
from src.auth.authentik import exchange_code_for_tokens, get_userinfo
from src.auth.network_access import client_allowed
from src.utils.json_script import json_for_script
from config.auth import can_sign_in_on, front_channel
from config.settings import settings

# Marker stored as the OAuth `auth_redirect` for browser (web) logins. The
# shared /auth/clerk/callback branches on this: web logins set a session cookie
# and redirect to /app; everything else does the vscode:// bounce.
WEB_AUTH_REDIRECT = "web:/app"

logger = logging.getLogger(__name__)

# DEF-S3. The callback sends the browser, with a one-time sign-in ticket, to
# the stored auth_redirect, so only an editor's own callback URI may be stored:
# a custom scheme, then "://publisher.name" and nothing else. That is exactly
# what the extension builds (packages/cloud/src/WebAuthService.ts:
# `${vscode.env.uriScheme}://${publisher}.${name}`), e.g.
# "vscode://QUB-IT.tumble-code", "vscode-insiders://...", "cursor://...".
# The callback path and the query are appended by the callback itself.
_AUTH_REDIRECT_RE = re.compile(
    r"(?P<scheme>[A-Za-z][A-Za-z0-9+.-]*)://[A-Za-z0-9-]+\.[A-Za-z0-9-]+"
)
# Schemes a browser opens itself (or that name local files) are never an
# editor callback, even when the rest of the value has the right shape.
_NON_EDITOR_SCHEMES = frozenset(
    {"http", "https", "javascript", "data", "file", "blob", "about", "ftp", "ws", "wss", "vbscript", "web"}
)


def is_allowed_auth_redirect(value: str) -> bool:
    """True when ``value`` is an editor callback URI we may send a ticket to."""
    match = _AUTH_REDIRECT_RE.fullmatch(value or "")
    return bool(match) and match.group("scheme").lower() not in _NON_EDITOR_SCHEMES


def _refuse_auth_redirect() -> HTMLResponse:
    return HTMLResponse(
        content=_auth_error_html(
            "Invalid sign-in request.",
            "The sign-in link does not return to an editor. Start the sign-in again from the extension.",
        ),
        status_code=400,
    )


router = APIRouter(tags=["browser-auth"])

# The sign-in pages live beside the web viewer's templates but stand alone
# (they extend nothing), so this module keeps its own loader.
_templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "web" / "templates"))


def _auth_success_html(redirect_url: str) -> str:
    """Render an HTML page that navigates to a vscode:// URI.

    Browsers often block HTTP 307 redirects to custom protocol URIs, so we
    return an HTML page that uses JavaScript + a fallback link instead
    (templates/auth_success.html).
    """
    return _templates.get_template("auth_success.html").render(
        redirect_url=redirect_url,
        redirect_js=json_for_script(redirect_url),
    )


def _auth_error_html(reason: str, detail: str = "") -> str:
    """Render an HTML error page for authentication failures (templates/auth_error.html)."""
    return _templates.get_template("auth_error.html").render(reason=reason, detail=detail)


async def _start_sign_in(
    request: Request,
    db: AsyncSession,
    state: str,
    auth_redirect: str,
    *,
    screen_hint: Optional[str] = None,
) -> Response:
    """Shared body of the extension's sign-in routes.

    Refuses a redirect that is not an editor callback (DEF-S3), stores the
    state with a fresh PKCE verifier, and sends the browser to Authentik's
    authorize URL, with ``&screen_hint=...`` appended when given.
    """
    if not is_allowed_auth_redirect(auth_redirect):
        return _refuse_auth_redirect()
    code_verifier, code_challenge = generate_pkce_pair()

    await store_oauth_state(db, state, auth_redirect, code_verifier)

    authorize_url = get_authorize_url(
        state=state,
        code_challenge=code_challenge,
        auth_redirect=auth_redirect,
        front=front_channel(request.headers.get("host")),
    )
    if screen_hint:
        authorize_url += f"&screen_hint={screen_hint}"
    return RedirectResponse(url=authorize_url)


@router.get("/extension/sign-in")
async def sign_in_page(
    request: Request,
    state: str = Query(...),
    auth_redirect: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Authentik OAuth authorize URL for sign-in."""
    return await _start_sign_in(request, db, state, auth_redirect)


@router.get("/extension/provider-sign-up")
async def provider_sign_up_page(
    request: Request,
    state: str = Query(...),
    auth_redirect: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Authentik OAuth authorize URL for sign-up."""
    return await _start_sign_in(request, db, state, auth_redirect, screen_hint="signup")


@router.get("/l/{slug}")
async def landing_page(
    slug: str,
    request: Request,
    state: str = Query(...),
    auth_redirect: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Authentik OAuth authorize URL for landing page flow.

    ``slug`` is not used: the route exists because the extension builds
    ``/l/<landingPageSlug>`` URLs (packages/cloud/src/WebAuthService.ts), and
    it behaves exactly like ``/extension/sign-in``.
    """
    return await _start_sign_in(request, db, state, auth_redirect)


@router.get("/app/login")
async def web_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Start the Authentik OAuth flow for a browser (web viewer) login.

    Uses the same redirect URI as the extension flow; the callback distinguishes
    web logins via the WEB_AUTH_REDIRECT marker stored in the OAuth state.

    A browser that reached us under a name with no registered callback (the
    machine's second address, say) is first moved to ``WEB_PUBLIC_URL``: a
    sign-in started there can come back there, and the session cookie lands on
    the host the reader then keeps using.
    """
    host = request.headers.get("host")
    if settings.web_public_url and not can_sign_in_on(host):
        return RedirectResponse(url=f"{settings.web_public_url}/app/login", status_code=303)

    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = generate_pkce_pair()
    await store_oauth_state(db, state, WEB_AUTH_REDIRECT, code_verifier)
    authorize_url = get_authorize_url(
        state=state,
        code_challenge=code_challenge,
        auth_redirect=WEB_AUTH_REDIRECT,
        front=front_channel(host),
    )
    return RedirectResponse(url=authorize_url)


@router.get("/app/logout")
async def web_logout(request: Request):
    """Clear the browser session cookie and return to the login page."""
    response = RedirectResponse(url="/app/login", status_code=303)
    clear_session_cookie(response, secure=cookie_should_be_secure(request))
    return response


@router.get("/auth/clerk/callback")
async def auth_callback(
    request: Request,
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

    # A web sign-in ends in a panel session cookie, so it is refused to a client
    # the panel itself would refuse, before the code is spent. The extension's
    # flow is not the panel and is not gated.
    client = request.client.host if request.client else None
    if state_store.auth_redirect == WEB_AUTH_REDIRECT and not client_allowed(client):
        logger.warning("[web-access] refused a web sign-in callback from %s", client)
        return HTMLResponse(
            content=_auth_error_html(
                "This panel is not open to your address.",
                "The server answers the web panel only to the networks listed in WEB_ALLOWED_NETWORKS.",
            ),
            status_code=403,
        )

    # A state row whose redirect is neither the web marker nor an editor
    # callback (stored before DEF-S3 was fixed, say) never gets a ticket.
    if state_store.auth_redirect != WEB_AUTH_REDIRECT and not is_allowed_auth_redirect(state_store.auth_redirect):
        logger.warning("Auth callback refused: the stored auth_redirect is not an editor callback URI")
        return _refuse_auth_redirect()

    # Exchange authorization code for tokens. The browser followed the
    # authorization request's redirect URI to get here, so the host it arrived
    # on names that same redirect URI.
    try:
        tokens = await exchange_code_for_tokens(
            code,
            state_store.code_verifier,
            redirect_uri=front_channel(request.headers.get("host")).redirect_uri,
        )
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
        # The internal user id, never the e-mail address: logs are read and
        # kept by more people and for longer than the users table.
        logger.info("Web auth callback successful for user %s", user.id)
        response = RedirectResponse(url="/app", status_code=303)
        set_session_cookie(
            response,
            session_id=session.id,
            user_id=user.id,
            secure=cookie_should_be_secure(request),
        )
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

    logger.info("Auth callback successful for user %s, redirecting to VS Code", user.id)

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
