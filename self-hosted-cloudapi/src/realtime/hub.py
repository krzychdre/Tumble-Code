"""In-memory connection registry for the remote-control bridge.

Pure bookkeeping with no socket.io / I/O dependency so it can be unit-tested
directly. The socket.io handlers in `sio.py` are thin glue over this.

Two kinds of sockets connect, both authenticated to a `user_id`:
- **extension** sockets: one per VS Code window (or CLI) of the user. Every
  one is tracked, in registration order. A command for a task goes to the
  socket that streams that task, so Stop reaches the window that runs it even
  when several windows are open; a task no window has streamed yet (resuming
  one from the web) goes to the newest window.
- **browser** sockets: subscribe to task rooms; events are relayed to them by
  socket.io room, so the registry only needs their per-sid metadata.

Pairing a browser to an extension is by shared `user_id` (the same identity on
both auth paths), which is what makes the relay safe and simple.
"""

from __future__ import annotations

import time
from typing import Optional, TypedDict


# The bridge event `type` of a task's live header/control snapshot
# (TaskBridgeEventName.InstanceState).
EVT_INSTANCE_STATE = "instanceState"


class SocketMeta(TypedDict):
    role: str  # "extension" | "browser"
    user_id: str


class ConnectionRegistry:
    # Most tasks a single extension socket streams in its lifetime; beyond this
    # the oldest answers are forgotten (and simply looked up again if needed),
    # so a client naming endless task ids cannot grow the cache without bound.
    TASK_ACCESS_CACHE_SIZE = 256

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        """Forget every socket (tests: the registry is a process singleton)."""
        # sid -> {role, user_id}
        self._meta: dict[str, SocketMeta] = {}
        # user_id -> registered extension sids, oldest first
        self._ext_sids_by_user: dict[str, list[str]] = {}
        # extension sid -> what it registered with (workspacePath, ...)
        self._instance_by_sid: dict[str, dict] = {}
        # sid -> {task_id: owned?}; see task_access().
        self._task_access_by_sid: dict[str, dict[str, bool]] = {}
        # task_id -> the extension sid that streams it; see note_task_event().
        self._task_sid: dict[str, str] = {}
        # task_id -> its last instanceState snapshot
        self._task_state: dict[str, dict] = {}

    # --- generic socket metadata ------------------------------------------

    def attach(self, sid: str, role: str, user_id: str) -> None:
        self._meta[sid] = SocketMeta(role=role, user_id=user_id)

    def meta(self, sid: str) -> Optional[SocketMeta]:
        return self._meta.get(sid)

    def detach(self, sid: str) -> Optional[SocketMeta]:
        """Remove a socket, and with an extension socket the tasks it streamed."""
        meta = self._meta.pop(sid, None)
        self._task_access_by_sid.pop(sid, None)
        self._instance_by_sid.pop(sid, None)
        if meta and meta["role"] == "extension":
            uid = meta["user_id"]
            sids = self._ext_sids_by_user.get(uid, [])
            if sid in sids:
                sids.remove(sid)
            if not sids:
                self._ext_sids_by_user.pop(uid, None)
        # The window is gone, so its tasks' snapshots (isRunning, the pending
        # ask) no longer describe anything live.
        for task_id in [t for t, owner in self._task_sid.items() if owner == sid]:
            del self._task_sid[task_id]
            self._task_state.pop(task_id, None)
        return meta

    # --- task ownership cache ---------------------------------------------

    def task_access(self, sid: str, task_id: str) -> Optional[bool]:
        """Whether this socket's user owns ``task_id``: True, False, or None if
        not known yet.

        The relay asks this for every streamed chunk, so the answer is kept for
        the lifetime of the socket instead of costing a query per chunk. That is
        sound because a task's owner never changes once its row exists, and the
        socket's user is fixed at the handshake. Only definite answers are
        stored (the caller never stores "no such task", which can change), and
        the whole map goes away with the socket in detach().
        """
        return self._task_access_by_sid.get(sid, {}).get(task_id)

    def remember_task_access(self, sid: str, task_id: str, owned: bool) -> None:
        if sid not in self._meta:
            # The socket disconnected while the lookup ran; nothing would ever
            # clear an entry recreated now.
            return
        cache = self._task_access_by_sid.setdefault(sid, {})
        if task_id not in cache and len(cache) >= self.TASK_ACCESS_CACHE_SIZE:
            cache.pop(next(iter(cache)))
        cache[task_id] = owned

    # --- extension instances ----------------------------------------------

    def register_extension(self, sid: str, user_id: str, instance: Optional[dict] = None) -> None:
        sids = self._ext_sids_by_user.setdefault(user_id, [])
        if sid in sids:
            sids.remove(sid)
        sids.append(sid)
        inst = dict(instance or {})
        inst["lastHeartbeat"] = time.time()
        self._instance_by_sid[sid] = inst

    def heartbeat(self, sid: str) -> None:
        inst = self._instance_by_sid.get(sid)
        if inst is not None:
            inst["lastHeartbeat"] = time.time()

    def note_task_event(self, sid: str, task_id: str, data: dict) -> None:
        """Record that this extension socket streams ``task_id`` (its user owns
        it: call only after the ownership check), and keep the task's latest
        instanceState snapshot.

        The last socket to report a task is the one that runs it now: a task
        moves windows only by being reopened there, and then that window
        streams it.
        """
        if sid not in self._meta:
            return
        self._task_sid[task_id] = sid
        if data.get("type") == EVT_INSTANCE_STATE:
            self._task_state[task_id] = dict(data)
            inst = self._instance_by_sid.get(sid)
            if inst is not None:
                inst["lastHeartbeat"] = time.time()

    def extension_sid(self, user_id: str, task_id: Optional[str] = None) -> Optional[str]:
        """The extension socket a command for ``task_id`` goes to: the one that
        streams the task, else the user's newest."""
        sids = self._ext_sids_by_user.get(user_id)
        if not sids:
            return None
        streaming = self._task_sid.get(task_id) if task_id else None
        if streaming in sids:
            return streaming
        return sids[-1]

    def instance(self, user_id: str, task_id: Optional[str] = None) -> Optional[dict]:
        """What the extension that runs ``task_id`` registered with, merged
        with the task's last snapshot; without a task (or a snapshot), the
        user's newest extension."""
        sid = self.extension_sid(user_id, task_id)
        if sid is None:
            return None
        inst = dict(self._instance_by_sid.get(sid) or {})
        state = self._task_state.get(task_id) if task_id else None
        if state is not None and self._task_sid.get(task_id) == sid:
            inst.update(state)
        return inst

    def has_extension(self, user_id: str) -> bool:
        return bool(self._ext_sids_by_user.get(user_id))


# Process-wide singleton (the API runs as a single instance for self-hosted).
registry = ConnectionRegistry()
