"""The per-IP rate limit reaches the routes of included routers.

slowapi's own middleware only saw top-level routes, so every route of an
``include_router`` counted as exempt and the limit guarded ``/health`` alone.
"""

import re

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute, iter_route_contexts
from fastapi.testclient import TestClient
from src.middleware.rate_limit import (
    RateLimitMiddleware,
    make_limiter,
    not_rate_limited,
    route_endpoint,
)


def _app(per_minute: int) -> FastAPI:
    router = APIRouter(prefix="/api")

    @router.get("/limited/{item}")
    async def limited(item: str):
        return {"item": item}

    @router.post("/ingest")
    @not_rate_limited
    async def ingest():
        return {"ok": True}

    nested = APIRouter(prefix="/nested")

    @nested.get("/deep")
    async def deep():
        return {"ok": True}

    router.include_router(nested)

    app = FastAPI()

    @app.get("/top")
    async def top():
        return {"ok": True}

    app.include_router(router)
    app.state.limiter = make_limiter(per_minute)
    app.add_middleware(RateLimitMiddleware)
    return app


def test_the_default_limit_applies_to_routes_of_included_routers():
    client = TestClient(_app(3))

    statuses = [client.get(f"/api/limited/{n}").status_code for n in range(5)]
    assert statuses == [200, 200, 200, 429, 429]

    nested = [client.get("/api/nested/deep").status_code for _ in range(4)]
    assert nested == [200, 200, 200, 429]

    top = [client.get("/top").status_code for _ in range(4)]
    assert top == [200, 200, 200, 429]


def test_a_route_marked_not_rate_limited_is_never_refused():
    client = TestClient(_app(2))

    assert {client.post("/api/ingest").status_code for _ in range(10)} == {200}


def test_an_unknown_path_is_not_counted():
    client = TestClient(_app(1))

    assert [client.get("/nope").status_code for _ in range(3)] == [404, 404, 404]
    assert client.get("/top").status_code == 200


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}:]+(:[^}]+)?\}", "x1", path)


def test_route_endpoint_finds_every_route_of_the_real_app():
    """Pins the walk through FastAPI's included routers: a FastAPI upgrade that
    changes them fails here instead of silently switching the limit off."""
    from src.main import app

    checked = 0
    for route in iter_route_contexts(app.router.routes):
        if not isinstance(route.original_route, APIRoute):
            continue
        method = sorted(route.methods)[0]
        scope = {
            "type": "http",
            "path": _concrete(route.path),
            "method": method,
            "root_path": "",
            "headers": [],
            "query_string": b"",
        }
        found = route_endpoint(app, scope)
        assert found is not None, route.path
        checked += 1
    assert checked > 50


def test_the_extension_ingest_routes_are_the_only_exempt_ones():
    from src.main import app

    exempt = sorted(
        f"{sorted(route.methods)[0]} {route.path}"
        for route in iter_route_contexts(app.router.routes)
        if isinstance(route.original_route, APIRoute)
        and getattr(route.endpoint, "__not_rate_limited__", False)
    )
    assert exempt == [
        "GET /api/llm-exchanges/config",
        "POST /api/events",
        "POST /api/llm-exchanges",
        "POST /api/llm-exchanges/outcome",
        "POST /api/tasks/{task_id}/images",
    ]
