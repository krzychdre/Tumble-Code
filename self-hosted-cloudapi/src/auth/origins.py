"""Which web origins may act with the reader's credentials.

One list, used in three places so they cannot drift apart:

* CORS (src/middleware/cors.py): which other pages may read the API's answers
  with the reader's cookie;
* the live bridge (src/realtime/sio.py): which pages may open a socket.io
  connection, on which the browser sends the session cookie by itself;
* the web panel's CSRF check (src/middleware/csrf.py): which pages may send a
  state-changing request that carries the session cookie.

Trusted are the service's own addresses (``API_BASE_URL`` and
``WEB_PUBLIC_URL``) plus the extra entries of ``CORS_ORIGINS``. The bridge and
the CSRF check also accept a page that is same-origin with the request itself
(its ``Origin`` names the ``Host`` the request was sent to): that is a page the
server served itself, e.g. the panel opened as ``127.0.0.1`` next to
``localhost``. A DNS-rebinding page can pass that test too, but it runs under
its own hostname, so the browser sends it none of our cookies.

The settings are read on every call, so a test (or a future settings reload)
changes the answer without rebuilding the app.
"""

from typing import List, Optional
from urllib.parse import urlsplit

from config.settings import normalize_origin, settings


def trusted_origins() -> List[str]:
    """The configured trusted origins, normalized, own addresses first."""
    origins: List[str] = []
    for candidate in (settings.api_base_url, settings.web_public_url, *settings.cors_origins_list):
        origin = normalize_origin(candidate)
        if origin and origin not in origins:
            origins.append(origin)
    return origins


def _same_origin_as_host(origin: str, host: Optional[str]) -> bool:
    """Does ``origin`` (already normalized) name the host the request went to?"""
    if not host:
        return False
    scheme, _, _ = origin.partition("://")
    if scheme not in ("http", "https"):
        return False
    return normalize_origin(f"{scheme}://{host.strip()}") == origin


def is_trusted_origin(origin: Optional[str], host: Optional[str] = None) -> bool:
    """Is a request whose ``Origin`` (or ``Referer`` origin) is ``origin`` from
    a trusted page? ``host`` is the request's ``Host`` header; pass it to accept
    same-origin pages as well."""
    normalized = normalize_origin(origin)
    if normalized is None:
        return False
    if normalized in trusted_origins():
        return True
    return _same_origin_as_host(normalized, host)



def origin_of_referer(referer: Optional[str]) -> Optional[str]:
    """The origin part of a ``Referer`` URL, or None when it has none."""
    if not referer:
        return None
    try:
        parts = urlsplit(referer.strip())
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return normalize_origin(f"{parts.scheme}://{parts.netloc}")
