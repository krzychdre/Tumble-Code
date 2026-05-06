"""Alembic environment configuration."""

import asyncio
import os
from logging import config as logging_config
from pathlib import Path

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

from src.database import Base
from src.models import (  # noqa: F401
    User, Session, ClientToken, Ticket,
    Organization, Membership,
    OrganizationSettings, UserSettings,
    Task, TaskMessage, TaskShare,
    TelemetryEvent, ProviderConfig, AuthentikStateStore,
)

config = context.config

# Load .env file if it exists (for running alembic outside docker)
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            os.environ.setdefault(*[part.strip() for part in _line.split("=", 1)])

# Only configure file-based logging if the config file defines loggers
# (avoids errors when running alembic without a full ini config)
if config.config_file_name:
    logging_config.fileConfig(config.config_file_name)

# Override sqlalchemy.url from DATABASE_URL environment variable at runtime
database_url = os.environ.get("DATABASE_URL")
if database_url:
    # Convert postgresql:// to postgresql+asyncpg:// for async support
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def run_migrations_offline():
    """Run migrations in offline mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"param": "value"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    """Run migrations with a given connection."""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    """Run migrations in async mode."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online():
    """Run migrations in online mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
