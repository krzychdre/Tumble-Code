"""Alembic environment configuration."""

import asyncio
from logging import config as logging_config

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# The app's own settings (DATABASE_URL from the environment or the env file
# CLOUDAPI_ENV_FILE names, default .env), so alembic and the server always
# talk to the same database.
from src.database import ASYNC_DATABASE_URL, Base
import src.models  # noqa: F401 - registers every table on Base.metadata

config = context.config

# Only configure file-based logging if the config file defines loggers
# (avoids errors when running alembic without a full ini config)
if config.config_file_name:
    logging_config.fileConfig(config.config_file_name)

# "%" is configparser interpolation syntax; a percent-encoded password must
# reach SQLAlchemy unchanged.
config.set_main_option("sqlalchemy.url", ASYNC_DATABASE_URL.replace("%", "%%"))

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
