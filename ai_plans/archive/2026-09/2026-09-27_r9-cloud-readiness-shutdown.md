# R9 — Cloud readiness/shutdown (2026-09-27)

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md` §2 R9.
Branch: `fix/r9-cloud-readiness-shutdown` off `main`.

## Problem

`self-hosted-cloudapi` had no production startup/shutdown hygiene:

1. `/health` never touched the database — a dead DB was invisible (container "healthy").
2. No Docker healthcheck on the `api` service.
3. `httpx` clients used default timeouts (5 s on everything), no retry policy.
4. The engine had no `pool_pre_ping` — a connection dropped behind the pool's back failed the first query after it.
5. uvicorn had no graceful-shutdown timeout.
6. socket.io was never closed on shutdown.

## Changes

### 1. `/health/ready` (readiness) — `self-hosted-cloudapi/src/main.py`

```python
# AFTER
@app.get("/health")
async def health_check():
    """Liveness: the process answers. Never touches the database, so a dead
    DB does not take the whole container down with it."""
    return {"status": "ok", "version": "0.1.0"}


@app.get("/health/ready")
async def readiness_check():
    """Readiness: ... SELECT 1 ... 503 when it does not."""
    from sqlalchemy import text
    from src.database import engine

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("readiness check failed: %s", exc)
        from fastapi.responses import JSONResponse
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {"status": "ready", "version": "0.1.0"}
```

Before, the only endpoint was `@app.get("/health")` returning a static dict.
Additive to the cloud-API contract (allowed by `docs/architecture.md`); the
existing `/health` route is untouched. The engine import is function-local (same
pattern as the lifespan) so tests can point `src.database.engine` at their own
fixture.

### 2. Docker healthcheck — `self-hosted-cloudapi/docker-compose.yml`

```yaml
# AFTER (api service)
healthcheck:
    # Readiness, not liveness: /health would report ok even with a dead
    # database. The slim image has no curl/wget; python ships with the
    # base image. /health/ready answers 503 when SELECT 1 fails.
    test:
        [
            "CMD",
            "python",
            "-c",
            "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT', '8085') + '/health/ready', timeout=3).status == 200 else 1)",
        ]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

The image is `python:3.13-slim` (no curl/wget installed; `build-essential` is
the only apt package) — stdlib `urllib.request` is the available probe. Reads
`PORT` from the container env so a non-default port keeps working.
`urlopen` raises on 503, so a non-200 exits non-zero either way.

### 3. httpx timeouts — `self-hosted-cloudapi/src/auth/authentik.py`

```python
# AFTER
AUTHENTIK_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)
...
async with httpx.AsyncClient(timeout=AUTHENTIK_TIMEOUT) as client:
```

Only two `httpx` call sites exist in the package (both here: token exchange,
userinfo). **No retry transport, on purpose:** the code exchange consumes a
single-use OAuth authorization code — replaying it after a timeout fails with
`invalid_grant`, so a retry cannot succeed; the browser flow surfaces the error
and the user can sign in again. Documented in the code comment.

### 4. `pool_pre_ping` — `self-hosted-cloudapi/src/database.py`

```python
# BEFORE
_engine_kwargs: dict = {"echo": False}
# AFTER
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}
```

A transparent round-trip before each checkout, so a connection dropped by the
server (restart, idle timeout) is replaced instead of surfacing as
"connection already closed". Applies to both drivers (SQLite tests, Postgres
prod) — `pool_pre_ping` is driver-agnostic.

### 5. Graceful shutdown — `self-hosted-cloudapi/docker-entrypoint.sh`

```sh
# AFTER
exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}" --timeout-graceful-shutdown 25
```

25 s: above Docker's 10 s default `stop` timeout — for the full window to be
usable, `docker stop -t 30` or a compose `stop_grace_period` is needed
(documented in `docs/08-cloud.md` and the entrypoint comment). Local `make dev`
/ `make run` keep no flag (dev reload flow, not a prod shutdown path).

### 6. socket.io shutdown in the lifespan — `self-hosted-cloudapi/src/main.py`

```python
# AFTER (lifespan shutdown)
from src.realtime.sio import sio
...
if settings.bridge_enabled:
    if sio.eio.service_task_handle is not None:
        await sio.shutdown()
await engine.dispose()
```

Discovery: python-socketio 5.17 `AsyncServer.shutdown()` delegates to
engine.io's `shutdown()`, which does `await self.service_task_handle` — but
that handle only exists after the first connection (`start_service_task` is
consumed lazily in `_handle_connect`); there is **no `startup()` method**.
Awaiting it with no task handle raises `TypeError: object NoneType can't be
used in 'await' expression`. Hence the guard: `shutdown()` only when the
service task exists. When a client was connected, shutdown disconnects it and
stops engine.io's background task; when the bridge ran but nobody connected,
there is nothing to stop.

`shutdown()` on the real object was **not** covered by an automated test (the
fakes pin that the lifespan calls it under the right conditions); manual
verification for the live stack: run the compose stack with `BRIDGE_ENABLED=true`,
open a task page (bridge connects), `docker stop -t 30 api` → logs show
"Socket.IO is shutting down" then "Roo Cloud API stopped", exit within the
window. A full e2e bridge-shutdown test would need a real engine.io client
against a served app — deferred as out of proportion to the fix.

### 7. Docs — `docs/08-cloud.md`

"Database and deploy" now records the graceful-shutdown flag, the compose
healthcheck on `/health/ready` (and that `/health` stays liveness-only), and
`pool_pre_ping`.

## Tests — `self-hosted-cloudapi/tests/test_health_shutdown.py` (new)

- `test_liveness_does_not_touch_the_database` — `/health` answers 200 with an
  engine whose `connect()` raises `AssertionError` (a query would fail the test).
- `test_readiness_returns_200_when_the_database_answers` — real file-backed
  engine, `SELECT 1` succeeds → 200 `{"status": "ready"}`.
- `test_readiness_returns_503_when_the_database_is_broken` — monkeypatched
  engine raising on connect → 503 `{"status": "unavailable"}` (deterministic,
  no real DB outage).
- `test_readiness_returns_503_when_select_fails` — connection opens, query
  raises → 503.
- `test_lifespan_shuts_the_bridge_down_on_exit` — spy sio with a live service
  task handle: lifespan exit calls `shutdown()`.
- `test_lifespan_skips_sio_shutdown_with_no_service_task` — no handle → no
  `shutdown()` call (the None-await crash case).
- `test_lifespan_skips_the_bridge_when_disabled` — bridge off → sio never touched.
- `test_engine_uses_pool_pre_ping` — asserts `_engine_kwargs["pool_pre_ping"] is True`
  (the dict `create_async_engine` is called with; no existing engine-config
  test file to extend).

Pins updated:

- `tests/test_route_table.py` — `("/health/ready", ("GET",), "readiness_check", "APIRoute")` added to `EXPECTED`.
- `tests/test_back_channel_host.py` — `_CapturingClient.__init__` now accepts
  the `timeout=` kwarg the real call passes.

## Result

`uv run pytest`: **822 passed, 1 xfailed** (was 812 passed before the branch;
+10 new tests, all pre-existing suites including R7 isolation and R8 races
green). `uvx ruff@0.15.12 check .` clean. `ruff format --check` reports the
same 4 touched files as "would reformat" as it does on main (the package's
format baseline is 108 unformatted files — pre-existing, not enforced).

## Residuals

- The compose healthcheck starts counting only after `start_period: 30s`
  (db-migrate runs first); a very slow first migration could still mark the
  container unhealthy once. Acceptable: `retries: 3` with `restart: unless-stopped`.
- `make dev`/`make run` (local) have no graceful-shutdown flag — dev-only paths.
- Live-stack shutdown verification (real engine.io client) is a manual step, see §6.
- Windows-style `docker stop` default 10 s cuts the 25 s window short unless
  `stop_grace_period`/`-t` is raised — documented, not defaulted in compose
  to keep the diff to the healthcheck only.
