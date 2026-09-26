"""SQLAlchemy database engine and session factory."""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config.settings import settings

# DATABASE_URL with the async driver; alembic/env.py uses the same value.
ASYNC_DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
_engine_kwargs: dict = {"echo": False}
# QueuePool tuning only applies to server-side databases; SQLite (used in
# tests and lightweight dev setups) uses StaticPool/NullPool and rejects
# these keys.
if ASYNC_DATABASE_URL.startswith("postgresql"):
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 10

engine = create_async_engine(ASYNC_DATABASE_URL, **_engine_kwargs)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


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
