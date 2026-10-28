"""Per-IP rate limiting.

Every route allows RATE_LIMIT_REQUESTS_PER_MINUTE requests a minute per
client address (slowapi's default limit, counted per route), except the routes marked
``@not_rate_limited``: the extension's own high-volume channels, which a
signed-in client calls once per message.

slowapi's own middleware finds a request's handler by looking for an
``endpoint`` on the top-level routes. FastAPI wraps every ``include_router``
in one route without an endpoint, so it found no handler for any route of a
router, treated them all as exempt, and the limit applied to ``/health``
alone. ``route_endpoint`` looks through the included routers instead
(tests/test_rate_limit.py checks it finds every route of the app).
"""

from typing import Any, Callable, Optional

from fastapi.routing import iter_route_contexts
from slowapi import Limiter
from slowapi.middleware import _should_exempt, sync_check_limits
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match
from starlette.types import Scope

from config.settings import settings


def make_limiter(requests_per_minute: int) -> Limiter:
    """The limiter the app uses: ``requests_per_minute`` per client address and route."""
    return Limiter(
        key_func=get_remote_address,
        default_limits=[f"{requests_per_minute}/minute"],
        # Counted per route, not per URL: /shared/<id> with a different id
        # each time is still one route.
        key_style="endpoint",
    )


limiter = (
    make_limiter(settings.rate_limit_requests_per_minute)
    if settings.rate_limit_enabled
    else None
)

_NOT_RATE_LIMITED = "__not_rate_limited__"


def not_rate_limited(endpoint: Callable[..., Any]) -> Callable[..., Any]:
    """Leave the endpoint out of the per-IP limit. Its guard is the Bearer token
    and its own size caps; say at the endpoint why it needs this."""
    setattr(endpoint, _NOT_RATE_LIMITED, True)
    return endpoint


def route_endpoint(app: Any, scope: Scope) -> Optional[Callable[..., Any]]:
    """The endpoint that will answer ``scope``, through included routers; None
    for a mount (static files, the bridge) or no route."""
    for route in iter_route_contexts(app.router.routes):
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route.endpoint
    return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    """slowapi's SlowAPIMiddleware with the handler found by ``route_endpoint``."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        active: Limiter = request.app.state.limiter
        if not active.enabled:
            return await call_next(request)

        handler = route_endpoint(request.app, request.scope)
        if getattr(handler, _NOT_RATE_LIMITED, False) or _should_exempt(
            active, handler
        ):
            return await call_next(request)

        error_response, inject_headers = sync_check_limits(
            active, request, handler, request.app
        )
        if error_response is not None:
            return error_response

        response = await call_next(request)
        if inject_headers:
            response = active._inject_headers(response, request.state.view_rate_limit)
        return response
