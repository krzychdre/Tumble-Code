"""FastAPI application factory and lifespan management."""

from contextlib import asynccontextmanager
from fastapi import FastAPI

from config.settings import settings
from src.middleware.cors import setup_cors
from src.middleware.request_logging import RequestLoggingMiddleware
from src.middleware.rate_limit import limiter
from src.routers import auth, extension, settings as settings_router, events, marketplace, proxy, browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    # Startup
    from src.database import engine, Base
    from src.models import (  # noqa: F401 - Import all models so tables are created
        User, Session, ClientToken, Ticket,
        Organization, Membership,
        OrganizationSettings, UserSettings,
        Task, TaskMessage, TaskShare,
        TelemetryEvent, ProviderConfig, AuthentikStateStore,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    print("Roo Cloud API started")
    print(f"  API Base URL: {settings.api_base_url}")
    print(f"  Authentik URL: {settings.authentik_base_url}")
    print(f"  JWT Algorithm: {settings.jwt_algorithm}")
    print(f"  Telemetry: {'enabled' if settings.telemetry_enabled else 'disabled'}")
    print(f"  Bridge: {'enabled' if settings.bridge_enabled else 'disabled'}")
    print(f"  Credits: {'enabled' if settings.credit_system_enabled else 'disabled'}")

    yield

    # Shutdown
    await engine.dispose()
    print("Roo Cloud API stopped")


app = FastAPI(
    title="Roo Code Cloud API",
    description="Self-hosted Roo Code Cloud API compatible with the Roo Code VS Code extension",
    version="0.1.0",
    lifespan=lifespan,
)

# Setup middleware
setup_cors(app)
app.add_middleware(RequestLoggingMiddleware)

# Apply rate limiter if enabled
if settings.rate_limit_enabled and limiter is not None:
    app.state.limiter = limiter
    from slowapi.middleware import SlowAPIMiddleware
    app.add_middleware(SlowAPIMiddleware)

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

# LLM Proxy
app.include_router(proxy.router)


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
