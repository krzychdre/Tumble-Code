"""A Content Security Policy for the web panel's pages (/app and /shared).

The panel runs no inline script: every page loads its behaviour from
``/static/`` (``app.js`` for the shared bits, one file per page for the rest)
and passes its data as ``<script type="application/json">`` islands, which a
browser never executes. So script-src can be ``'self'`` alone: an injected
``<script>`` or ``onerror=`` attribute simply does not run.

What the policy allows, and why:

- ``style-src 'self'``: the stylesheet and the no-script stylesheet. A
  ``<style>`` element is refused (CSS selectors can exfiltrate attribute
  values). ``style-src-attr 'unsafe-inline'`` keeps the handful of computed
  ``style="..."`` attributes (tree depth, bar widths) working; an attribute
  cannot load anything or run code.
- ``img-src 'self' data: https:``: attachments are data: URLs; an image a
  model put in its Markdown is an https: URL.
- ``connect-src 'self' ws://host wss://host``: the live bridge's socket.io,
  which polls over XHR and upgrades to a websocket on the same host. The
  websocket origins are spelled out because older browsers do not let
  ``'self'`` cover ws:/wss:.
- ``frame-ancestors 'none'``, ``base-uri 'self'``, ``form-action 'self'``,
  ``object-src 'none'``: no framing, no ``<base>`` rewrite, forms post only
  here, no plugins.

The sign-in pages of routers/browser.py (``/auth/...``) are left alone: they
live outside the panel's prefixes, and the error page closes its tab through a
``javascript:`` link. JSON responses need no policy.

A pure ASGI middleware, so it only touches the response headers and never
re-streams a body.
"""

import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_PREFIXES = ("/app", "/shared")
_HOST = re.compile(r"^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$")

_BASE = (
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
)


def policy_for(host: str | None) -> str:
    connect = "connect-src 'self'"
    if host and _HOST.match(host):
        connect += f" ws://{host} wss://{host}"
    return "; ".join((*_BASE, connect))


def _applies(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") or path.startswith(p + "?") for p in _PREFIXES)


class ContentSecurityPolicyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _applies(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        host = None
        for name, value in scope.get("headers", []):
            if name == b"host":
                host = value.decode("latin-1")
                break

        async def send_with_policy(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                content_type = next((v for k, v in headers if k == b"content-type"), b"")
                if content_type.startswith(b"text/html"):
                    headers.append((b"content-security-policy", policy_for(host).encode("latin-1")))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_policy)
