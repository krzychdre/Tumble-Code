"""The shared skeleton of the background maintenance loops.

Every service loop — retention sweep, recall card rebuild, auth row purge,
organization sync — is the same asyncio task: run one sweep in its own
session, log a failure, sleep. The single deliberate difference is whether
the first sweep waits one interval; see ``sleep_first``.
"""

import asyncio
import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from src.database import async_session_factory

logger = logging.getLogger(__name__)


async def run_periodic(
    label: str,
    interval: float,
    sweep: Callable[[AsyncSession], Awaitable[None]],
    *,
    sleep_first: bool,
) -> None:
    """Run ``sweep`` in its own session every ``interval`` seconds, forever.

    ``sweep`` commits the session and logs its own per-cycle counts. A
    failure is logged and the next tick tries again: an API server must
    not lose a background task to one bad row and then silently stop
    sweeping forever. Cancellation still propagates.
    """
    if sleep_first:
        await asyncio.sleep(interval)
    while True:
        try:
            async with async_session_factory() as db:
                await sweep(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Logged and swallowed on purpose — see the docstring.
            logger.exception("[%s] cycle failed; will retry next tick", label)
        await asyncio.sleep(interval)
