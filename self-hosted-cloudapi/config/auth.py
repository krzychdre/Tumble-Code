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

A browser on another machine
----------------------------
The front channel is configured as ``localhost`` in a single-host setup, and on
another machine ``localhost`` is that machine: a browser opening the panel at
``http://192.168.50.141:8085`` was sent to ``http://localhost:9000`` to sign in
and back to ``http://localhost:8085``, neither of which it can reach. When the
request arrived on the host named by ``WEB_PUBLIC_URL``, ``front_channel`` sends
the browser to Authentik on that same host and back to the public callback
instead. Only that one configured host is used, never whatever ``Host`` header a
request carries: Authentik must have the callback registered (the blueprint does
it from the same variable), and it is the registration that keeps codes from
being issued to anybody else's address.
"""

from dataclasses import dataclass
from ipaddress import ip_address
from typing import Optional
from urllib.parse import urlsplit

from config.settings import settings


def _front_channel_base() -> str:
    """Base URL for endpoints the browser is redirected to."""
    return settings.authentik_base_url


def _hostname(netloc: Optional[str]) -> Optional[str]:
    """The host part of a ``Host`` header value, lowercased, without the port."""
    if not netloc:
        return None
    return urlsplit(f"//{netloc}").hostname


def is_loopback_host(hostname: Optional[str]) -> bool:
    """``localhost`` or a loopback address."""
    if not hostname:
        return False
    if hostname == "localhost":
        return True
    try:
        return ip_address(hostname).is_loopback
    except ValueError:
        return False


def public_host() -> Optional[str]:
    """The hostname of ``WEB_PUBLIC_URL``, or None when it is not set."""
    return urlsplit(settings.web_public_url).hostname if settings.web_public_url else None


def arrived_on_public_host(request_host: Optional[str]) -> bool:
    """Did this request reach us through ``WEB_PUBLIC_URL``'s host?"""
    public = public_host()
    return public is not None and _hostname(request_host) == public


def can_sign_in_on(request_host: Optional[str]) -> bool:
    """Is a callback registered for a browser that reached us on this host?

    Loopback, the configured redirect URI's host, and ``WEB_PUBLIC_URL``'s host.
    A request without a ``Host`` header gets the benefit of the doubt: there is
    no better address to send it to.
    """
    hostname = _hostname(request_host)
    if hostname is None:
        return True
    return (
        is_loopback_host(hostname)
        or hostname == urlsplit(settings.authentik_redirect_uri).hostname
        or hostname == public_host()
    )


@dataclass(frozen=True)
class FrontChannel:
    """Where one browser is sent to sign in, and where it comes back to."""

    authentik_base: str
    redirect_uri: str

    @property
    def authorize_url(self) -> str:
        return f"{self.authentik_base}/application/o/authorize/"


def front_channel(request_host: Optional[str] = None) -> FrontChannel:
    """The sign-in round trip for a browser that reached us on ``request_host``.

    The configured URLs, unless the browser came in on ``WEB_PUBLIC_URL``'s
    host. Then the callback is the public one, and Authentik is addressed on the
    same host as well when it is configured on loopback (the bundled stack
    publishes it on every interface); an Authentik configured under a real name
    is reachable as it is and stays as configured.
    """
    if not arrived_on_public_host(request_host):
        return FrontChannel(settings.authentik_base_url, settings.authentik_redirect_uri)

    public = public_host()
    authentik = urlsplit(settings.authentik_base_url)
    base = settings.authentik_base_url
    if is_loopback_host(authentik.hostname):
        host = f"[{public}]" if ":" in public else public  # an IPv6 literal
        netloc = host if authentik.port is None else f"{host}:{authentik.port}"
        base = authentik._replace(netloc=netloc).geturl()
    callback = urlsplit(settings.authentik_redirect_uri).path
    return FrontChannel(base, f"{settings.web_public_url}{callback}")


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


def get_authentik_token_url() -> str:
    """Get the Authentik token endpoint URL (back-channel / server)."""
    return f"{_back_channel_base()}/application/o/token/"


def get_authentik_userinfo_url() -> str:
    """Get the Authentik userinfo endpoint URL (back-channel / server)."""
    return f"{_back_channel_base()}/application/o/userinfo/"
