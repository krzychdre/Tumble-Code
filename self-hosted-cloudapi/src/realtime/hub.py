"""In-memory connection registry for the remote-control bridge.

Pure bookkeeping with no socket.io / I/O dependency so it can be unit-tested
directly. The socket.io handlers in `sio.py` are thin glue over this.

Two kinds of sockets connect, both authenticated to a `user_id`:
- **extension** sockets — at most one live instance per user is tracked (the
  most recently registered wins); commands are relayed to its `sid`.
- **browser** sockets — subscribe to task rooms; events are relayed to them by
  socket.io room, so the registry only needs their per-sid metadata.

Pairing a browser to an extension is by shared `user_id` (the same identity on
both auth paths), which is what makes the relay safe and simple.
"""

from __future__ import annotations

import time
from typing import Optional, TypedDict


class SocketMeta(TypedDict):
    role: str  # "extension" | "browser"
    user_id: str


class ConnectionRegistry:
    def __init__(self) -> None:
        # sid -> {role, user_id}
        self._meta: dict[str, SocketMeta] = {}
        # user_id -> extension sid (newest registered instance wins)
        self._ext_sid_by_user: dict[str, str] = {}
        # user_id -> last registered/updated ExtensionInstance-ish dict
        self._instance_by_user: dict[str, dict] = {}

    # --- generic socket metadata ------------------------------------------

    def attach(self, sid: str, role: str, user_id: str) -> None:
        self._meta[sid] = SocketMeta(role=role, user_id=user_id)

    def meta(self, sid: str) -> Optional[SocketMeta]:
        return self._meta.get(sid)

    def detach(self, sid: str) -> Optional[SocketMeta]:
        """Remove a socket; if it was the user's registered extension, clear it."""
        meta = self._meta.pop(sid, None)
        if meta and meta["role"] == "extension":
            uid = meta["user_id"]
            if self._ext_sid_by_user.get(uid) == sid:
                self._ext_sid_by_user.pop(uid, None)
                self._instance_by_user.pop(uid, None)
        return meta

    # --- extension instance -----------------------------------------------

    def register_extension(self, sid: str, user_id: str, instance: Optional[dict] = None) -> None:
        self._ext_sid_by_user[user_id] = sid
        inst = dict(instance or {})
        inst["lastHeartbeat"] = time.time()
        self._instance_by_user[user_id] = inst

    def heartbeat(self, user_id: str) -> None:
        inst = self._instance_by_user.get(user_id)
        if inst is not None:
            inst["lastHeartbeat"] = time.time()

    def update_instance_state(self, user_id: str, state: dict) -> None:
        """Merge a live instance_state snapshot into the stored instance."""
        inst = self._instance_by_user.setdefault(user_id, {})
        inst.update(state)
        inst["lastHeartbeat"] = time.time()

    def extension_sid(self, user_id: str) -> Optional[str]:
        return self._ext_sid_by_user.get(user_id)

    def instance(self, user_id: str) -> Optional[dict]:
        return self._instance_by_user.get(user_id)

    def has_extension(self, user_id: str) -> bool:
        return user_id in self._ext_sid_by_user


# Process-wide singleton (the API runs as a single instance for self-hosted).
registry = ConnectionRegistry()
