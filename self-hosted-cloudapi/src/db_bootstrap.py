"""Startup schema reconciler — classify the database and seed a fresh one.

Why this exists: the migration chain's baseline (a1b2c3d4e5f6) is a no-op and the
later migrations are evolution-only (ALTER/ADD COLUMN). The schema is actually
built by ``Base.metadata.create_all`` from the ORM models — the single source of
truth. So a *fresh* database cannot be bootstrapped by ``alembic upgrade head``.

This module probes the live DB and prints one of:

    FRESH    no application tables   -> we create_all here; caller should `stamp head`
    LEGACY   app tables, no alembic  -> caller should `stamp baseline && upgrade head`
    MANAGED  app tables + alembic    -> caller should `upgrade head`

The presence of *application tables* (not the alembic_version table) is the real
signal. A database with an ``alembic_version`` row but no app tables is a failed
bootstrap — the previous, broken `alembic upgrade head` stamped the no-op baseline
and then crashed on the first ALTER. We treat that as FRESH so it self-heals:
``create_all`` builds the schema and ``stamp head`` overwrites the stale version.

Only ``FRESH`` performs DDL (create_all); the alembic step is left to the
entrypoint so its output is logged like any other migration run.
"""

import asyncio

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncEngine

from src.database import Base
import src.models  # noqa: F401 -- registers every table on Base.metadata


async def classify_and_seed(engine: AsyncEngine) -> str:
    """Classify ``engine``'s database; create_all when it has no app tables."""
    async with engine.begin() as conn:
        def probe(sync_conn):
            insp = inspect(sync_conn)
            return insp.has_table("alembic_version"), insp.has_table("users")

        has_alembic, has_app_tables = await conn.run_sync(probe)

        if has_app_tables:
            return "MANAGED" if has_alembic else "LEGACY"

        # No app tables: either a brand-new DB or a failed prior bootstrap that
        # left only a stale alembic_version. Build the schema from the models;
        # the entrypoint then `stamp head` (overwriting any stale version row).
        await conn.run_sync(Base.metadata.create_all)
        return "FRESH"


def main() -> None:
    # Imported lazily so importing this module (e.g. for tests) doesn't construct
    # the app engine / require full settings.
    from src.database import engine

    async def _run() -> str:
        try:
            return await classify_and_seed(engine)
        finally:
            # Dispose within the same loop the connections were opened on;
            # disposing from a second asyncio.run() raises "Event loop is closed".
            await engine.dispose()

    print(asyncio.run(_run()))


if __name__ == "__main__":
    main()
