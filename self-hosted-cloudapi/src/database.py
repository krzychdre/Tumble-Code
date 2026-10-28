"""SQLAlchemy database engine and session factory."""

from typing import Callable, Optional

from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from config.settings import settings

# DATABASE_URL with the async driver; alembic/env.py uses the same value.
ASYNC_DATABASE_URL = settings.database_url.replace(
    "postgresql://", "postgresql+asyncpg://"
)
# pool_pre_ping: a transparent round-trip before each checkout, so a
# connection dropped by the server (restart, idle timeout) is replaced
# instead of surfacing as "connection already closed" on the first query.
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}
# QueuePool tuning only applies to server-side databases; SQLite (used in
# tests and lightweight dev setups) uses StaticPool/NullPool and rejects
# these keys.
if ASYNC_DATABASE_URL.startswith("postgresql"):
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 10

# The session settings of every Postgres connection. asyncpg prepares each
# statement, and after five runs on a pooled connection Postgres may keep a
# generic plan that cannot see the user, the period or the filter: the task
# list's statements and a heavy user's live writes then took several times
# longer, a narrowed metrics page minutes. JIT compiled each large metrics
# statement for about a second more than it saved.
_PG_SESSION_SETTINGS = {"plan_cache_mode": "force_custom_plan", "jit": "off"}


def make_engine(url: str, **options) -> AsyncEngine:
    """An async engine on ``url``; on Postgres every connection it opens
    starts with the app's session settings."""
    if url.startswith("postgresql"):
        options["connect_args"] = {"server_settings": _PG_SESSION_SETTINGS}
    return create_async_engine(url, **options)


engine = make_engine(ASYNC_DATABASE_URL, **_engine_kwargs)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# The two dialects with a native INSERT ... ON CONFLICT: Postgres in
# production, SQLite in the tests.
_DIALECT_INSERTS = {"postgresql": postgresql.insert, "sqlite": sqlite.insert}


def dialect_insert(db: AsyncSession) -> Optional[Callable]:
    """The ``insert`` of the session's dialect, the one that has
    ``on_conflict_do_nothing`` / ``on_conflict_do_update``.

    None on any other dialect: the caller then falls back to a plain insert.
    """
    return _DIALECT_INSERTS.get(db.bind.dialect.name)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""

    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields a database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
