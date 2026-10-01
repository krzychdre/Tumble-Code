# Fix: socket.io bridge WebSocket handshake returns 404 (ASGI RuntimeError)

## Symptom

On every bridge WebSocket connection the server logs:

```
RuntimeError: Expected ASGI message 'websocket.accept', 'websocket.close',
or 'websocket.http.response.start' but got 'http.response.start'.
```

The connection is opened then immediately closed; the handshake never reaches
the socket.io `connect` handler.

## Root cause (verified)

`src/main.py` mounts the relay as a Starlette sub-app:

```python
app.mount("/bridge", socketio.ASGIApp(sio, socketio_path="socket.io"))
```

`socketio.ASGIApp(..., socketio_path="socket.io")` configures engine.io's
`ASGIApp` with `engineio_path = "/socket.io/"`. engine.io decides whether a
request belongs to it by testing the **raw** `scope["path"]`:

```python
self._ensure_trailing_slash(scope['path']).startswith(self.engineio_path)
```

It does NOT account for ASGI `root_path`.

In Starlette 0.50.0 (`routing.py` `Mount.matches`), mounting a sub-app no longer
rewrites `scope["path"]` — it only appends the prefix to `root_path` and leaves
`scope["path"]` as the full original path. So the client request to
`/bridge/socket.io/?EIO=4&transport=websocket` arrives at the sub-app with
`scope["path"] == "/bridge/socket.io/"`, which does **not** start with
`/socket.io/`. engine.io treats it as unrelated traffic and calls `not_found()`,
which emits an HTTP `http.response.start` (404) onto a WebSocket connection —
uvicorn rejects that with the RuntimeError above.

(Confirmed: client connects with `path: "/bridge/socket.io"` in
`packages/cloud/src/bridge/BridgeOrchestrator.ts:77`.)

## Fix

Tell engine.io its full public path so it matches the un-stripped
`scope["path"]`. Mount stays at `/bridge` (keeps `app` a FastAPI instance, so
tests' `app.dependency_overrides` keep working):

```python
app.mount("/bridge", socketio.ASGIApp(sio, socketio_path="bridge/socket.io"))
```

`socketio_path="bridge/socket.io"` → `engineio_path = "/bridge/socket.io/"`,
which `/bridge/socket.io/...` starts with. Client path is unchanged.

## Verification

- Restart uvicorn; connect the extension bridge → handshake reaches `connect`,
  no RuntimeError, `connection open` stays open.
- `tests/test_bridge.py` still passes.
