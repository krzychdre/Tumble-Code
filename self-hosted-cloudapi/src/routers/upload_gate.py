"""The one gate the large uploads (LLM exchanges, task backfills) pass through
while their body is read and parsed."""

import time
from collections import Counter
from contextlib import asynccontextmanager

import anyio
from fastapi import HTTPException

from config.settings import settings


class ParseGate:
    """How many uploads are read and parsed at once, in all and per user.

    An LLM exchange is up to 128 MiB once inflated and a task backfill up to
    BACKFILL_MAX_BYTES, and parsing either builds several times that in Python
    objects. The endpoints are outside the per-IP limit, so without this a
    handful of parallel uploads from one token could take the container's
    memory. A request waits up to ``wait_seconds`` for its turn: past it the
    answer is 429 when the user already has ``per_user`` uploads in flight,
    else 503; both carry Retry-After (the extension retries an exchange, not a
    backfill, which is best-effort).

    The body is read inside the slot: until it is read, the server holds back
    the connection's input, so a waiting upload costs a socket, not its size.
    Waiting polls a counter instead of using an anyio primitive, which would
    belong to the first event loop that used it (the tests run several).
    """

    POLL_SECONDS = 0.05

    def __init__(self) -> None:
        self.in_flight = 0
        self.per_user_in_flight: Counter[str] = Counter()

    async def _wait(self, has_room, deadline: float) -> bool:
        while not has_room():
            if time.monotonic() >= deadline:
                return False
            await anyio.sleep(self.POLL_SECONDS)
        return True

    @asynccontextmanager
    async def slot(
        self, user_id: str, *, capacity: int, per_user: int, wait_seconds: float
    ):
        deadline = time.monotonic() + wait_seconds
        if not await self._wait(
            lambda: self.per_user_in_flight[user_id] < per_user, deadline
        ):
            raise HTTPException(
                status_code=429,
                detail="Too many uploads in flight for this user",
                headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
            )
        self.per_user_in_flight[user_id] += 1
        try:
            if not await self._wait(lambda: self.in_flight < capacity, deadline):
                raise HTTPException(
                    status_code=503,
                    detail="The server is busy with other uploads",
                    headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
                )
            self.in_flight += 1
            try:
                yield
            finally:
                self.in_flight -= 1
        finally:
            self.per_user_in_flight[user_id] -= 1
            if self.per_user_in_flight[user_id] <= 0:
                del self.per_user_in_flight[user_id]


RETRY_AFTER_SECONDS = 5
parse_gate = ParseGate()


def upload_slot(user_id: str):
    """A turn to read and parse one large upload of ``user_id``."""
    return parse_gate.slot(
        user_id,
        capacity=settings.llm_exchange_parse_concurrency,
        per_user=settings.llm_exchange_parse_per_user,
        wait_seconds=settings.llm_exchange_parse_wait_seconds,
    )
