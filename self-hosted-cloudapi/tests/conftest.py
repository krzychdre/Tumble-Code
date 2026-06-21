"""Test fixtures and configuration.

Env vars are populated before any `src.*` import so `config.settings.Settings()`
and `src.database.create_async_engine(...)` see valid values during module load.
"""

import os

# Set required env vars BEFORE importing anything from src.
# (config.settings is loaded at import-time and validates required fields.)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("API_BASE_URL", "http://testserver")
os.environ.setdefault("AUTHENTIK_BASE_URL", "http://authentik-test.local")
os.environ.setdefault("AUTHENTIK_CLIENT_ID", "test-client-id")
os.environ.setdefault(
    "AUTHENTIK_REDIRECT_URI", "http://testserver/auth/clerk/callback"
)
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-please-ignore")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import pytest  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
)
from sqlalchemy.pool import StaticPool  # noqa: E402

from src.database import Base, get_db  # noqa: E402
# Importing src.models populates Base.metadata with all tables.
import src.models  # noqa: E402, F401


@pytest.fixture
async def test_engine():
    """Per-test async SQLite engine. StaticPool keeps a single in-memory DB
    shared across the test client request and the seeding session."""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session_factory(test_engine):
    return async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture
async def db_session(session_factory):
    """Session for direct DB seeding/assertions inside tests."""
    async with session_factory() as session:
        yield session


@pytest.fixture
def client(session_factory):
    """FastAPI TestClient with get_db overridden to the test engine.

    Not using `with TestClient(app)` so the app's lifespan (which would touch
    the production engine) doesn't run.
    """
    from fastapi.testclient import TestClient
    from src.main import app

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
