"""Coalesce streamed partial message rows before they reach the database (P11).

A streaming ClineMessage (reasoning, text, a command's output) is re-sent by
the extension on every chunk, always with its whole accumulated text and
always under the same ``ts``. Only the latest revision of the row matters, yet
the bridge used to open a session and commit once per chunk: dozens of
transactions per second for one row while a model thinks.

Here a partial is held for a short window per ``(task_id, ts)`` and then
written once; chunks arriving inside the window only replace the held
revision. The window is fixed from the first held chunk (it is not reset by
later ones), so a long stream is still written at least every ``delay``
seconds and the stored history never lags further behind than that.

What is never held:
- a final revision (``partial`` falsy) or a message without a ``ts``: written
  at once by the caller, which first calls :meth:`settle` to drop the held
  partial of the same ``ts`` (the final supersedes it) and to take the task's
  other held partials along into the same transaction;
- anything the caller decides must be written at once (the first chunk of a
  task whose owner is not known yet: that write creates the task row and
  answers the ownership question).

Held revisions are written when their socket disconnects
(:meth:`flush_sid`) and when the app shuts down (:meth:`flush_all`), so a
stream cut off mid-way still leaves its last revision behind.
"""

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

# How long a partial row may wait for a newer revision before it is written.
FLUSH_DELAY_S = 0.25

# write(sid, task_id, user_id, events): persist the message events of one task
# in one transaction. Must not raise (the bridge logs and carries on).
Writer = Callable[[str, str, str, list[dict]], Awaitable[Any]]


@dataclass
class _Held:
    sid: str
    user_id: str
    data: dict
    size: int
    timer: Optional[asyncio.Task] = field(default=None, repr=False)


class PartialMessageBuffer:
    def __init__(self, write: Writer, delay: float = FLUSH_DELAY_S) -> None:
        self._write = write
        self.delay = delay
        self._held: dict[tuple[str, Any], _Held] = {}
        # Timers that have taken their row out of ``_held`` and are writing it.
        self._writing: dict[tuple[str, Any], asyncio.Task] = {}

    def pending(self) -> int:
        """How many rows are held or being written."""
        return len(self._held) + len(self._writing)

    def hold(self, sid: str, task_id: str, user_id: str, data: dict) -> None:
        """Hold the partial message event ``data`` (its message has a ``ts``)."""
        message = data["message"]
        key = (task_id, message["ts"])
        # The same measure as the database's upsert guard (length of the
        # stored JSON), so the held revision is the one the guard would keep:
        # chunks can be handled out of order, and a shorter partial must never
        # replace a fuller one.
        size = len(json.dumps(message))
        held = self._held.get(key)
        if held is not None:
            if size >= held.size:
                held.data, held.size = data, size
            return
        held = _Held(sid=sid, user_id=user_id, data=data, size=size)
        self._held[key] = held
        held.timer = asyncio.create_task(self._write_later(key))

    async def _write_later(self, key: tuple[str, Any]) -> None:
        await asyncio.sleep(self.delay)
        held = self._held.pop(key, None)
        if held is None:
            return
        self._writing[key] = held.timer
        try:
            await self._write(held.sid, key[0], held.user_id, [held.data])
        finally:
            if self._writing.get(key) is held.timer:
                del self._writing[key]

    async def settle(self, task_id: str, ts: Any) -> list[dict]:
        """Prepare an immediate write of ``(task_id, ts)``.

        Drops the held partial of that ``ts`` (the write supersedes it), waits
        for a write of it already under way (so an older partial cannot land
        after the final), and returns the task's other held partials, oldest
        first, for the caller to write in the same transaction.
        """
        own = self._held.pop((task_id, ts), None)
        if own is not None and own.timer is not None:
            own.timer.cancel()
        underway = self._writing.get((task_id, ts))
        if underway is not None:
            # asyncio.wait: a cancelled caller does not cancel that write.
            await asyncio.wait({underway})
        return [held.data for held in self._take(lambda key, held: key[0] == task_id)]

    async def flush_sid(self, sid: str) -> None:
        """Write every row held for socket ``sid`` now (it is going away)."""
        await self._flush(self._take(lambda key, held: held.sid == sid))

    async def flush_all(self) -> None:
        """Write every held row now and wait for writes under way (shutdown)."""
        await self._flush(self._take(lambda key, held: True))
        if self._writing:
            await asyncio.wait(set(self._writing.values()))

    def discard(self) -> None:
        """Drop every held row without writing it (tests)."""
        for held in self._take(lambda key, held: True):
            if held.timer is not None:
                held.timer.cancel()

    def _take(self, keep: Callable[[tuple[str, Any], _Held], bool]) -> list:
        """Remove and return the held rows ``keep`` selects, timers cancelled."""
        taken = [(key, held) for key, held in self._held.items() if keep(key, held)]
        for key, held in taken:
            del self._held[key]
            if held.timer is not None:
                held.timer.cancel()
        return [held for _key, held in taken]

    async def _flush(self, rows: list) -> None:
        # One transaction per (socket, task): the writer is per task.
        groups: dict[tuple[str, str, str], list[dict]] = {}
        for held in rows:
            task_id = held.data["taskId"]
            groups.setdefault((held.sid, task_id, held.user_id), []).append(held.data)
        for (sid, task_id, user_id), events in groups.items():
            await self._write(sid, task_id, user_id, events)
