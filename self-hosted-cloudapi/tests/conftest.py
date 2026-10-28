"""Test fixtures and configuration.

Env vars are populated before any `src.*` import so `config.settings.Settings()`
and `src.database.make_engine(...)` see valid values during module load.
"""

import os

# Set required env vars BEFORE importing anything from src.
# (config.settings is loaded at import-time and validates required fields.)

# Read no .env file: the developer's own .env would otherwise override the
# values below and the defaults the tests rely on.
os.environ["CLOUDAPI_ENV_FILE"] = ""
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
# Secrets must be 32+ characters and not a placeholder (config/settings.py).
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-the-test-suite-only")
os.environ.setdefault("API_BASE_URL", "http://testserver")
os.environ.setdefault("AUTHENTIK_BASE_URL", "http://authentik-test.local")
os.environ.setdefault("AUTHENTIK_CLIENT_ID", "test-client-id")
os.environ.setdefault("AUTHENTIK_REDIRECT_URI", "http://testserver/auth/clerk/callback")
os.environ.setdefault("AUTHENTIK_API_TOKEN", "test-authentik-api-token-0123456789")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-please-ignore-0123456789")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import pytest  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
)
from sqlalchemy.pool import NullPool, StaticPool  # noqa: E402

from src.database import Base, get_db, make_engine  # noqa: E402

# Importing src.models populates Base.metadata with all tables.
import src.models  # noqa: E402, F401


def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
    """Make SQLite enforce foreign keys (and ON DELETE actions) like Postgres.

    SQLite ignores FOREIGN KEY clauses unless each connection opts in, so a
    write that Postgres rejects (a child row whose parent does not exist yet)
    would pass here unnoticed. The pragma is a no-op inside a transaction,
    which is why it runs on connect, before anything else touches the
    connection.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


@pytest.fixture
async def test_engine():
    """Per-test async SQLite engine. StaticPool keeps a single in-memory DB
    shared across the test client request and the seeding session.

    Every connection enforces foreign keys, the way Postgres does (the
    production database); see ``_enable_sqlite_foreign_keys``.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
    async with engine.begin() as conn:
        # Guard against a silent no-op (for example a driver that opens the
        # connection inside a transaction): fail loudly instead of letting
        # the whole suite run without foreign key checks.
        enforced = (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar()
        assert enforced == 1, "SQLite foreign key enforcement is off"
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


# A Postgres database the tests may own (the CI job's service container, see
# tests/test_recall_pg.py): what SQLite cannot show runs there too.
PG_URL = os.environ.get("RECALL_PG_URL")


@pytest.fixture
async def pg_session():
    """Session on the Postgres of RECALL_PG_URL, its schema rebuilt from the
    models and its connection set up the app's way; the test skips without
    it."""
    if not PG_URL:
        pytest.skip("RECALL_PG_URL is not set")
    engine = make_engine(PG_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session
    await engine.dispose()


@pytest.fixture(params=["db_session", "pg_session"])
def any_db(request):
    """A test using it runs on SQLite and on the Postgres of RECALL_PG_URL."""
    return request.getfixturevalue(request.param)


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

    # Every override a test sets (the signed-in user, the web user) goes with
    # the test: the app is one module-level object, and an override left
    # behind made a later test's "no token, 401" pass or fail by file order.
    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _drop_held_bridge_partials():
    """The bridge holds streamed partial rows back for a short window (P11).

    The buffer is a process singleton: a test that ends with a partial still
    held must not leave its timer behind to fire into a closed event loop or
    a disposed engine.
    """
    yield
    from src.realtime.sio import partial_messages

    partial_messages.discard()


@pytest.fixture(autouse=True)
def authentik_groups(monkeypatch):
    """The groups Authentik answers the organization sync with (none unless a
    test adds some), so no test reaches out to an Authentik."""
    groups: list = []

    async def fetch_groups():
        return groups

    monkeypatch.setattr("src.services.organizations.fetch_groups", fetch_groups)
    return groups
