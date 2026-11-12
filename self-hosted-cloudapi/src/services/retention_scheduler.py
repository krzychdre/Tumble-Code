"""Background loop that applies each user's retention policy on a schedule.

An in-process asyncio task rather than a cron entry or a worker process: this is
a single-container deployment, the sweep is a handful of DELETEs, and adding a
scheduler dependency to run it would be more machinery than the job is worth.

It only ever acts on policies that are switched on: a user who has never
opened the settings page has a disabled policy and is never touched.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.services.periodic import run_periodic
from src.services.retention_service import sweep_all_enabled

logger = logging.getLogger(__name__)


async def _sweep(db: AsyncSession) -> None:
    count = await sweep_all_enabled(db)
    await db.commit()
    if count:
        logger.info("[retention] swept %s enabled polic(ies)", count)


async def run_retention_loop() -> None:
    """Sweep every enabled policy every ``retention_sweep_hours``, forever."""
    interval = max(1, settings.retention_sweep_hours) * 3600
    # Never on the very first tick: startup is when the schema is being
    # reconciled and the first requests are arriving, and a sweep is not urgent.
    await run_periodic("retention", interval, _sweep, sleep_first=True)
