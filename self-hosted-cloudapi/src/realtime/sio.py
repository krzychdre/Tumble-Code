"""socket.io server: the live remote-control relay.

Topology (the backend is always in the middle — no direct VS Code ↔ browser link):

    extension  --(extension:register / task:event)-->  server  --(task:relayed_event)-->  browser
    browser    --(task:command)-->                     server  --(task:relayed_command)-->  extension

Auth happens once, at the socket.io handshake (`connect`):
- extension: presents a session JWT in the handshake `auth.token` (fetched from
  /api/extension/bridge/config). Validated with `decode_token`.
- browser: presents the signed `tumble_session` cookie (sent automatically on a
  same-origin connection). Validated with `resolve_web_user`.

Both resolve to a `user_id`; a browser may only join/drive tasks it owns, and a
command is relayed only to that same user's extension socket.
"""

import logging
from typing import Optional

import socketio
from sqlalchemy import select

from config.settings import settings
from src.auth.jwt_issuer import decode_token
from src.auth.static_token import validate_static_token
from src.auth.web_session import COOKIE_NAME, resolve_web_user
from src.database import async_session_factory
from src.models.task import Task
from src.services.telemetry_service import upsert_task_message
from src.realtime.hub import registry

logger = logging.getLogger(__name__)

# Event names — mirror the TS enums in packages/types/src/cloud.ts.
EXT_REGISTER = "extension:register"
EXT_UNREGISTER = "extension:unregister"
EXT_HEARTBEAT = "extension:heartbeat"

TASK_JOIN = "task:join"
TASK_LEAVE = "task:leave"
TASK_EVENT = "task:event"  # from extension
TASK_RELAYED_EVENT = "task:relayed_event"  # to browsers
TASK_COMMAND = "task:command"  # from browser
TASK_RELAYED_COMMAND = "task:relayed_command"  # to extension

# Bridge event `type` discriminators (TaskBridgeEventName).
EVT_MESSAGE = "message"
EVT_INSTANCE_STATE = "instanceState"


def _create_server() -> socketio.AsyncServer:
    origins = settings.cors_origins_list
    return socketio.AsyncServer(
        async_mode="asgi",
        # "*" disables the Origin check; a concrete list restricts it.
        cors_allowed_origins="*" if origins == ["*"] else origins,
        logger=False,
        engineio_logger=False,
    )


sio = _create_server()


def _room(task_id: str) -> str:
    return f"task:{task_id}"


def _user_id_from_token(token: Optional[str]) -> Optional[str]:
    """Resolve a handshake bearer/JWT/static token to a user_id, or None."""
    if not token:
        return None
    static_result = validate_static_token(token)
    if static_result is not None:
        return static_result.get("user_id")
    payload = decode_token(token)
    if payload is None:
        return None
    return payload.get("r", {}).get("u") or payload.get("sub")


def _cookie_from_environ(environ: dict) -> Optional[str]:
    """Extract the tumble_session cookie value from the ASGI handshake environ."""
    raw_cookie_header = environ.get("HTTP_COOKIE", "")
    if not raw_cookie_header:
        return None
    for part in raw_cookie_header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE_NAME:
            return value
    return None


async def _user_owns_task(user_id: str, task_id: str) -> bool:
    if not task_id:
        return False
    async with async_session_factory() as db:
        result = await db.execute(
            select(Task.id).where(Task.id == task_id, Task.user_id == user_id)
        )
        return result.scalar_one_or_none() is not None


# --- lifecycle ------------------------------------------------------------


@sio.event
async def connect(sid, environ, auth):
    """Authenticate the handshake and tag the socket with its role + user_id.

    Returning False rejects the connection.
    """
    auth = auth or {}
    token = auth.get("token")

    if token:
        user_id = _user_id_from_token(token)
        if not user_id:
            logger.info("[bridge] extension handshake rejected: invalid token")
            return False
        registry.attach(sid, "extension", user_id)
        return True

    # No token → browser; authenticate via the session cookie.
    async with async_session_factory() as db:
        web_user = await resolve_web_user(_cookie_from_environ(environ), db)
    if web_user is None:
        logger.info("[bridge] browser handshake rejected: no valid session")
        return False
    registry.attach(sid, "browser", web_user["user_id"])
    return True


@sio.event
async def disconnect(sid):
    registry.detach(sid)


# --- extension → server ---------------------------------------------------


@sio.on(EXT_REGISTER)
async def on_extension_register(sid, data):
    meta = registry.meta(sid)
    if not meta or meta["role"] != "extension":
        return {"success": False, "error": "not an extension socket"}
    registry.register_extension(sid, meta["user_id"], data if isinstance(data, dict) else {})
    return {"success": True}


@sio.on(EXT_HEARTBEAT)
async def on_extension_heartbeat(sid, data=None):
    meta = registry.meta(sid)
    if meta and meta["role"] == "extension":
        registry.heartbeat(meta["user_id"])
    return {"success": True}


@sio.on(EXT_UNREGISTER)
async def on_extension_unregister(sid, data=None):
    registry.detach(sid)
    return {"success": True}


@sio.on(TASK_EVENT)
async def on_task_event(sid, data):
    """An event from the extension's task: relay to browsers + persist messages."""
    meta = registry.meta(sid)
    if not meta or meta["role"] != "extension":
        return
    if not isinstance(data, dict):
        return
    task_id = data.get("taskId")
    if not task_id:
        return

    # Relay to every browser watching this task.
    await sio.emit(TASK_RELAYED_EVENT, data, room=_room(task_id))

    user_id = meta["user_id"]
    evt_type = data.get("type")

    if evt_type == EVT_INSTANCE_STATE:
        registry.update_instance_state(user_id, data)

    if evt_type == EVT_MESSAGE and isinstance(data.get("message"), dict):
        try:
            async with async_session_factory() as db:
                await upsert_task_message(db, task_id, user_id, data["message"])
                await db.commit()
        except Exception as exc:  # persistence must never break the live relay
            logger.warning("[bridge] failed to persist task message: %s", exc)


# --- browser → server -----------------------------------------------------


@sio.on(TASK_JOIN)
async def on_task_join(sid, data):
    meta = registry.meta(sid)
    if not meta:
        return {"success": False, "error": "unauthenticated"}
    task_id = (data or {}).get("taskId")
    if not await _user_owns_task(meta["user_id"], task_id):
        return {"success": False, "error": "forbidden"}
    await sio.enter_room(sid, _room(task_id))
    instance = registry.instance(meta["user_id"])
    return {
        "success": True,
        "taskId": task_id,
        "instanceOnline": registry.has_extension(meta["user_id"]),
        "instance": instance,
    }


@sio.on(TASK_LEAVE)
async def on_task_leave(sid, data):
    task_id = (data or {}).get("taskId")
    if task_id:
        await sio.leave_room(sid, _room(task_id))
    return {"success": True}


@sio.on(TASK_COMMAND)
async def on_task_command(sid, data):
    """A command from the browser: relay only to that user's extension socket."""
    meta = registry.meta(sid)
    if not meta or meta["role"] != "browser":
        return {"success": False, "error": "not a browser socket"}
    if not isinstance(data, dict):
        return {"success": False, "error": "bad payload"}
    task_id = data.get("taskId")
    if not await _user_owns_task(meta["user_id"], task_id):
        return {"success": False, "error": "forbidden"}
    ext_sid = registry.extension_sid(meta["user_id"])
    if not ext_sid:
        return {"success": False, "error": "extension offline"}
    await sio.emit(TASK_RELAYED_COMMAND, data, to=ext_sid)
    return {"success": True}
