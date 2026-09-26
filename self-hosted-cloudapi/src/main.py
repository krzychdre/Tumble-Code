"""FastAPI application factory and lifespan management."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from config.auth import is_loopback_host
from config.settings import settings
from src.auth.network_access import WebAccessMiddleware, describe_policy
from src.auth.web_session import LoginRequired, redirect_to_login
from src.auth.origins import trusted_origins
from src.logging_setup import configure_logging
from src.middleware.cors import setup_cors
from src.middleware.csrf import CsrfOriginMiddleware
from src.middleware.request_logging import RequestLoggingMiddleware
from src.middleware.rate_limit import limiter
from src.routers import auth, extension, settings as settings_router, events, marketplace, browser, web


configure_logging(settings.log_level)
logger = logging.getLogger(__name__)


def _log_banner() -> None:
    """Log the effective configuration once at startup."""
    logger.info("Roo Cloud API started")
    logger.info("  API Base URL: %s", settings.api_base_url)
    logger.info("  Authentik URL: %s", settings.authentik_base_url)
    logger.info("  JWT Algorithm: %s", settings.jwt_algorithm)
    logger.info("  Web panel open to: %s", describe_policy())
    if settings.web_public_url:
        logger.info("  Web panel public URL: %s", settings.web_public_url)
    elif settings.web_allowed_networks and is_loopback_host(urlsplit(settings.authentik_base_url).hostname):
        # The allowlist lets other machines in, but sign-in would still send
        # them to localhost, which on their side is themselves.
        logger.warning(
            "WEB_ALLOWED_NETWORKS is set but WEB_PUBLIC_URL is not; "
            "other machines can open the panel but cannot sign in"
        )
    logger.info("  Trusted web origins: %s", ", ".join(trusted_origins()))
    if settings.cors_origins_has_wildcard:
        # Kept running rather than refused: every .env copied from an older
        # .env.example carries "*", and a rebuild must not stop the service.
        logger.warning(
            "CORS_ORIGINS contains '*', which is no longer honoured "
            "(it let any web page act with a signed-in reader's cookie); "
            "remove it and list extra origins explicitly if you need any"
        )
    logger.info("  Telemetry: %s", "enabled" if settings.telemetry_enabled else "disabled")
    logger.info("  Bridge: %s", "enabled" if settings.bridge_enabled else "disabled")
    logger.info(
        "  Retention sweep: %s",
        f"every {settings.retention_sweep_hours}h" if settings.retention_sweep_enabled else "disabled",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events.

    No create_all here: the schema is db-migrate.sh's job (the container runs
    it before uvicorn, `make migrate` runs it locally), see src/db_bootstrap.py.
    Building tables at startup left them without an alembic_version row, so a
    later migrate took the database for LEGACY and the migrations that create
    tables failed on tables that already existed.
    """
    # Imported here so tests can point src.database.engine elsewhere.
    from src.database import engine

    _log_banner()

    sweeper = None
    if settings.retention_sweep_enabled:
        from src.services.retention_scheduler import run_retention_loop

        sweeper = asyncio.create_task(run_retention_loop())

    yield

    # Shutdown
    if sweeper is not None:
        sweeper.cancel()
        try:
            await sweeper
        except asyncio.CancelledError:
            pass
    await engine.dispose()
    logger.info("Roo Cloud API stopped")


app = FastAPI(
    title="Roo Code Cloud API",
    description="Self-hosted Roo Code Cloud API compatible with the Roo Code VS Code extension",
    version="0.1.0",
    lifespan=lifespan,
)

# Setup middleware
setup_cors(app)
# Outside CORS (a preflight is an OPTIONS and passes), inside the request
# logging, so a refused forgery is still logged with its 403.
app.add_middleware(CsrfOriginMiddleware)
# Inside the request logging, so a refused request is still logged with its 403.
app.add_middleware(WebAccessMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# Apply rate limiter if enabled
if settings.rate_limit_enabled and limiter is not None:
    app.state.limiter = limiter
    from slowapi.middleware import SlowAPIMiddleware
    app.add_middleware(SlowAPIMiddleware)

# A web route that needs a signed-in reader raises LoginRequired (usually via
# the require_web_user dependency); this sends the browser to the login page.
app.add_exception_handler(LoginRequired, redirect_to_login)

# Register routers
# Clerk-compatible auth facade
app.include_router(auth.router)

# Browser auth flow routes
app.include_router(browser.router)

# Extension API
app.include_router(extension.router)

# Settings API
app.include_router(settings_router.router)

# Events API
app.include_router(events.router)

# Marketplace API
app.include_router(marketplace.router)

# Web UI (task list + read-only task viewer)
app.include_router(web.router)

# Static assets for the web UI (CSS, vendored JS, the renderer)
_STATIC_DIR = Path(__file__).resolve().parent / "web" / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

# Live remote-control bridge (socket.io). Mounted as a sub-app so `app` stays a
# FastAPI instance (tests rely on app.dependency_overrides). The engine.io
# endpoint lands at settings.bridge_path (default /bridge/socket.io), the same
# value the extension and the web panel are told to connect to.
#
# NOTE: starlette's Mount (>=0.50) no longer strips the mount prefix from
# scope["path"]; it only adjusts root_path. engine.io matches its endpoint
# against the raw scope["path"] and ignores root_path, so socketio_path must
# repeat the mount prefix or every handshake falls through to a 404, which
# crashes the WebSocket with "Expected ASGI message 'websocket.accept'...".
def mount_bridge(target: FastAPI, bridge_path: str) -> None:
    """Mount the socket.io app so its endpoint is exactly ``bridge_path``.

    ``/bridge/socket.io`` mounts at ``/bridge`` with socketio_path
    ``bridge/socket.io``. Settings guarantees at least two segments.
    """
    import socketio
    from src.realtime.sio import sio

    prefix = bridge_path.rsplit("/", 1)[0]
    target.mount(prefix, socketio.ASGIApp(sio, socketio_path=bridge_path.lstrip("/")))


if settings.bridge_enabled:
    mount_bridge(app, settings.bridge_path)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True,
    )
