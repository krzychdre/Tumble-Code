"""Auth-related configuration helpers.

Authentik is reached over two channels that may need different hostnames:

* **front-channel** — URLs the *browser* is redirected to (`authorize`,
  `end-session`). These must be publicly reachable, e.g. ``http://localhost:9000``.
* **back-channel** — URLs the *api server* fetches over httpx (`token`,
  `userinfo`, `jwks`, discovery). Inside a single docker-compose these must use
  the compose service name (e.g. ``http://auth_server:9000``) because the api
  container's own ``localhost`` is not Authentik.

``settings.authentik_internal_url`` configures the back-channel base; when unset
it falls back to ``authentik_base_url`` so single-host deployments are unchanged.

Brand / Host header
-------------------
Authentik resolves a request's *brand* — and therefore serves its
``/application/o/*`` routes — from the HTTP ``Host`` header. The back-channel
base is an in-network service name (e.g. ``http://auth_server:9000`` in the
bundled compose stack), so httpx would send ``Host: auth_server:9000``. Authentik
(Django) rejects that with **404 on every application route** because the
underscore makes ``auth_server`` an invalid RFC-1123 hostname. The browser flow
works only because the front-channel host (``localhost:9000`` in dev,
``auth.tumblecode.dev`` in production) is valid.

So back-channel calls must connect to the service name (for DNS) but present the
public front-channel host as ``Host`` — see ``get_back_channel_host_header``.
"""

from typing import Optional
from urllib.parse import urlsplit

from config.settings import settings


def _front_channel_base() -> str:
    """Base URL for endpoints the browser is redirected to."""
    return settings.authentik_base_url


def _back_channel_base() -> str:
    """Base URL for endpoints the api server fetches itself."""
    return settings.authentik_internal_url or settings.authentik_base_url


def get_back_channel_host_header() -> Optional[str]:
    """``Host`` header to send on back-channel (server-to-server) requests.

    Returns the public *front-channel* host (host[:port] of
    ``authentik_base_url`` — e.g. ``auth.tumblecode.dev`` or ``localhost:9000``)
    whenever a distinct internal URL is configured, so Authentik resolves the
    correct brand instead of 404-ing on the internal service name.

    Returns ``None`` when no internal URL is set (front == back channel); httpx's
    default ``Host`` already matches, so no override is needed.
    """
    if not settings.authentik_internal_url:
        return None
    return urlsplit(settings.authentik_base_url).netloc or None


def get_authentik_authorize_url() -> str:
    """Get the Authentik authorization endpoint URL (front-channel / browser)."""
    return f"{_front_channel_base()}/application/o/authorize/"


def get_authentik_token_url() -> str:
    """Get the Authentik token endpoint URL (back-channel / server)."""
    return f"{_back_channel_base()}/application/o/token/"


def get_authentik_userinfo_url() -> str:
    """Get the Authentik userinfo endpoint URL (back-channel / server)."""
    return f"{_back_channel_base()}/application/o/userinfo/"


def get_authentik_issuer_url() -> str:
    """Get the Authentik issuer URL."""
    return f"{_front_channel_base()}/application/o/{settings.authentik_app_slug}/"


def get_authentik_end_session_url() -> str:
    """Get the Authentik end-session (logout) endpoint URL (front-channel / browser)."""
    return f"{_front_channel_base()}/application/o/{settings.authentik_app_slug}/end-session/"


def get_authentik_jwks_url() -> str:
    """Get the Authentik JWKS endpoint URL (back-channel / server)."""
    return f"{_back_channel_base()}/application/o/{settings.authentik_app_slug}/jwks/"


def get_authentik_discovery_url() -> str:
    """Get the Authentik OpenID discovery document URL (back-channel / server)."""
    return f"{_back_channel_base()}/application/o/{settings.authentik_app_slug}/.well-known/openid-configuration"
