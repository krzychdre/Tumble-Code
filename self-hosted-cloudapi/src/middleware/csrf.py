"""Cross-site request forgery check for cookie-authenticated requests (DEF-S9).

The web panel's forms (delete a task, bulk delete, save and run the retention
policy) are authenticated by the ``tumble_session`` cookie alone. ``SameSite=Lax``
keeps the cookie off cross-site POSTs, but "site" ignores the port: Authentik
on :9000, or any other service on the same host or LAN address, is same-site
and could submit the panel's forms with the reader's cookie.

So a state-changing request (anything but GET, HEAD, OPTIONS, TRACE) that
carries the session cookie must come from a trusted page, as decided by
src/auth/origins.py:

* its ``Origin`` header decides when present (``null``, sent by sandboxed
  frames and ``data:`` pages, is refused);
* without ``Origin``, the origin of its ``Referer`` decides;
* with neither, the request is let through. Every current browser sends
  ``Origin`` on a cross-origin POST (and on same-origin ones too), so such a
  request was not forged by a web page; it comes from a program that holds the
  cookie itself, against which no header check can protect. Refusing it would
  only break the odd script or privacy proxy that strips both headers.

Requests without the session cookie are not checked: nothing ambient rides on
them. That keeps the extension's Bearer-token API (Node, no cookie jar) and
the socket.io bridge's polling (which engine.io checks itself) out of the way.
"""

from starlette.datastructures import Headers
from starlette.requests import cookie_parser
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from src.auth.origins import is_trusted_origin, origin_of_referer
from src.auth.web_session import COOKIE_NAME

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def cross_site_refusal(method: str, headers: Headers) -> bool:
    """Should this request be refused as a possible forgery?"""
    if method.upper() in SAFE_METHODS:
        return False
    if COOKIE_NAME not in cookie_parser(headers.get("cookie", "")):
        return False

    host = headers.get("host")
    origin = headers.get("origin")
    if origin is not None:
        return not is_trusted_origin(origin, host)

    referer = headers.get("referer")
    if referer is not None:
        return not is_trusted_origin(origin_of_referer(referer), host)

    return False


class CsrfOriginMiddleware:
    """Refuse cookie-authenticated state changes from untrusted pages (403)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and cross_site_refusal(scope["method"], Headers(scope=scope)):
            response = PlainTextResponse("Cross-site request refused", status_code=403)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
