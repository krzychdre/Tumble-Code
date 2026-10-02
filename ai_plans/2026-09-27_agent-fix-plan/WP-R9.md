# WP-R9: Cloud readiness probe, timeouts and graceful shutdown

Status: ready
Effort: M      Risk: low      Depends on: none (shares `tests/test_route_table.py` with WP-R10; different lines, merges cleanly)
Branch name: fix/r9-readiness-and-shutdown      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Add `GET /health/ready` that runs `SELECT 1` with a timeout and answers 503 when the database does not answer
(`/health` stays exactly as it is), and use it as the api container's compose healthcheck. Give the Authentik
back-channel calls an explicit `httpx.Timeout` and one retry on connect errors. Give the engine
`pool_pre_ping=True` and, for PostgreSQL only, a connect timeout. Bound uvicorn's graceful shutdown and close
socket.io clients in the lifespan shutdown.

## 2. Why it matters (user-visible effect, 2-4 sentences)

Today the container is "up" even when PostgreSQL is gone, and nothing restarts or flags it. After a Postgres
restart the pool hands out dead connections and the first requests fail. A stalled Authentik hangs sign-in on
httpx's implicit 5 s-everything default with no retry, and a brief DNS/connect blip fails a sign-in outright. On
`docker compose stop/restart`, uvicorn waits forever for open socket.io connections, gets SIGKILLed after 10 s,
and the lifespan shutdown (retention loop cancel, engine dispose) never runs.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md`; `docs/architecture.md` "Do not touch", bullet "Cloud API" (`/bridge` socket path, SQLite as the
  test DB).
- `self-hosted-cloudapi/src/main.py`: `lifespan`, `health_check`, `mount_bridge`.
- `self-hosted-cloudapi/src/database.py`: module-level `_engine_kwargs`, `engine`.
- `self-hosted-cloudapi/src/auth/authentik.py`: `exchange_code_for_tokens`, `get_userinfo`.
- `self-hosted-cloudapi/src/realtime/sio.py`: `sio` (a `socketio.AsyncServer`).
- `self-hosted-cloudapi/docker-entrypoint.sh`, `Dockerfile`, `docker-compose.yml` (service `api`).
- `self-hosted-cloudapi/tests/test_back_channel_host.py`: `_CapturingClient` (monkeypatches
  `authentik.httpx.AsyncClient`; must accept constructor kwargs after this change).
- `self-hosted-cloudapi/tests/test_route_table.py`: `EXPECTED` (pins every route).
- `self-hosted-cloudapi/tests/conftest.py`: `client` fixture (does not run the lifespan; `DATABASE_URL` is
  `sqlite+aiosqlite:///:memory:`, so `src.database.engine` is a working SQLite engine in tests).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/database.py` (near line 8):

```python
# DATABASE_URL with the async driver; alembic/env.py uses the same value.
ASYNC_DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
_engine_kwargs: dict = {"echo": False}
# QueuePool tuning only applies to server-side databases; SQLite (used in
# tests and lightweight dev setups) uses StaticPool/NullPool and rejects
# these keys.
if ASYNC_DATABASE_URL.startswith("postgresql"):
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 10

engine = create_async_engine(ASYNC_DATABASE_URL, **_engine_kwargs)
```

`src/main.py`, end of `lifespan` (near line 88) and `health_check` (near line 181):

```python
    # Shutdown
    if sweeper is not None:
        sweeper.cancel()
        try:
            await sweeper
        except asyncio.CancelledError:
            pass
    await engine.dispose()
    logger.info("Roo Cloud API stopped")
```

```python
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}
```

`src/auth/authentik.py`, `exchange_code_for_tokens` / `get_userinfo` (near lines 70-110):

```python
    async with httpx.AsyncClient() as client:
        token_data = {
```

```python
        response = await client.post(
            get_authentik_token_url(),
            data=token_data,
            headers=_back_channel_headers(
                {"Content-Type": "application/x-www-form-urlencoded"}
            ),
        )
        response.raise_for_status()
```

```python
    async with httpx.AsyncClient() as client:
        response = await client.get(
            get_authentik_userinfo_url(),
            headers=_back_channel_headers(
                {"Authorization": f"Bearer {access_token}"}
            ),
        )
        response.raise_for_status()
```

`docker-entrypoint.sh` (last line):

```sh
exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}"
```

`docker-compose.yml`, service `api` has `depends_on` and `restart: unless-stopped` but no `healthcheck` and no
`stop_grace_period`.

## 5. Root cause / analysis

VERIFIED (read, ran, or inspected the installed packages: uvicorn 0.53.0, httpx 0.28.1, python-socketio 5.17.0,
SQLAlchemy 2.0.54, asyncpg 0.31.0, FastAPI 0.141.1):
- `/health` never touches the database; no healthcheck exists for `api` in compose; the Dockerfile has none.
- uvicorn `Server.shutdown()`: closes listeners, asks connections to shut down, then waits for tasks with
  `timeout=config.timeout_graceful_shutdown` (None = forever), and only THEN runs the lifespan shutdown. Docker's
  default stop timeout is 10 s, so without a bound the lifespan shutdown is skipped by SIGKILL.
- `uvicorn.Config(proxy_headers=True)` is already the default, and uvicorn only trusts `X-Forwarded-*` from
  `FORWARDED_ALLOW_IPS` (default 127.0.0.1). Adding `--proxy-headers` changes nothing; it is added only to make the
  choice visible. `--forwarded-allow-ips '*'` must NOT be added: `WEB_ALLOWED_NETWORKS` gating
  (`src/auth/network_access.py`) decides on the client address, which a forged `X-Forwarded-For` would then set.
- `socketio.AsyncServer.shutdown()` only stops the engine.io service task; it does NOT disconnect clients.
  `sio.eio.disconnect()` (no sid) closes every client, but runs `asyncio.wait([...])` which raises `ValueError`
  on an empty list, so it must be guarded with `if sio.eio.sockets:`. Both verified by reading the installed
  sources; the guard is covered by a test.
- Every new test in section 7 passes with the change; the whole suite passes except the 2 pre-existing
  `test_metrics_characterization.py` failures. `docker compose config -q` accepts the edited compose file
  (checked with `AUTH_PG_PASS=x AUTHENTIK_SECRET_KEY=y`).
- `tests/test_back_channel_host.py` breaks unless `_CapturingClient` accepts constructor kwargs (a plain class
  without `__init__` rejects `timeout=`); step 7 fixes the test double.

Decisions:
- One `AsyncClient` per call is kept (not one shared client). Sign-in happens rarely; a shared client would need
  lifespan creation/closing and would defeat the existing test doubles that monkeypatch `httpx.AsyncClient`.
- Retry only `httpx.ConnectError` and `httpx.ConnectTimeout` (the request never reached Authentik). A read
  timeout or an error status is NOT retried: the authorization code is single use.
- `/health/ready` opens its own connection from `src.database.engine` instead of using `get_db`: the `get_db`
  dependency commits after the handler, and a probe must not fail on the way out. The engine is looked up at call
  time (`from src import database; database.engine`) so tests can monkeypatch it (the lifespan already does the
  same lookup for that reason).
- Dockerfile `HEALTHCHECK`: NOT added. Compose is the supported deployment and its `healthcheck` overrides an image
  one anyway; one definition is easier to keep right. (Optional; say so in the PR.)
- `pool_pre_ping=True` is passed for every URL (SQLite pools accept it; verified by building an engine); pool
  sizing and `connect_args={"timeout": 10}` (asyncpg's connect timeout, seconds) only for PostgreSQL URLs.

HYPOTHESIS: `uv run` (PID 1 via `exec`) forwards SIGTERM to the uvicorn child (uv documents signal forwarding for
`uv run`). To confirm on a machine with the stack: `docker compose up -d api && docker compose stop api && docker
compose logs api | tail -20` should show uvicorn's "Shutting down" and then "Roo Cloud API stopped" within 20 s.
If "Roo Cloud API stopped" is missing, report it; the fix would be `exec .venv/bin/uvicorn ...` in the
entrypoint, but do not make that change without reporting first.

## 6. Step-by-step changes

Step 1. `self-hosted-cloudapi/src/database.py`. Find the whole block quoted in section 4 (from
`# DATABASE_URL with the async driver; alembic/env.py uses the same value.` to
`engine = create_async_engine(ASYNC_DATABASE_URL, **_engine_kwargs)`) and replace it with:

```python
# Seconds asyncpg waits to open a connection before giving up. Without it a
# database that stops answering (not refusing) holds every request for the
# driver's default of a minute.
DB_CONNECT_TIMEOUT_SECONDS = 10


def engine_kwargs(url: str) -> dict:
    """Keyword arguments for ``create_async_engine(url, ...)``.

    ``pool_pre_ping`` tests a pooled connection before handing it out, so a
    connection the database dropped (a Postgres restart, an idle timeout)
    is replaced instead of failing the request that drew it.

    Pool sizing and the asyncpg connect timeout only apply to PostgreSQL:
    SQLite (the test database, and lightweight dev setups) uses its own pools
    and its driver rejects both.
    """
    kwargs: dict = {"echo": False, "pool_pre_ping": True}
    if url.startswith("postgresql"):
        kwargs["pool_size"] = 20
        kwargs["max_overflow"] = 10
        kwargs["connect_args"] = {"timeout": DB_CONNECT_TIMEOUT_SECONDS}
    return kwargs


# DATABASE_URL with the async driver; alembic/env.py uses the same value.
ASYNC_DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")

engine = create_async_engine(ASYNC_DATABASE_URL, **engine_kwargs(ASYNC_DATABASE_URL))
```

(`_engine_kwargs` is not referenced anywhere else; checked with `grep -rn _engine_kwargs self-hosted-cloudapi`.)

Step 2. `self-hosted-cloudapi/src/main.py`.

2a. Find:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
```

Replace with:

```python
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
```

2b. Find the lifespan shutdown block quoted in section 4 (from `    # Shutdown` to
`    logger.info("Roo Cloud API stopped")`) and replace it with:

```python
    # Shutdown
    if sweeper is not None:
        sweeper.cancel()
        try:
            await sweeper
        except asyncio.CancelledError:
            pass
    if settings.bridge_enabled:
        await _close_bridge()
    await engine.dispose()
    logger.info("Roo Cloud API stopped")


async def _close_bridge() -> None:
    """Disconnect every socket.io client and stop the server's background task.

    Best effort and bounded: a shutdown must never hang on a client that does
    not answer. ``eio.disconnect()`` with no sid closes every client, but
    raises on an empty set (``asyncio.wait([])``), hence the guard.
    """
    from src.realtime.sio import sio

    try:
        if sio.eio.sockets:
            await asyncio.wait_for(sio.eio.disconnect(), timeout=5)
        await asyncio.wait_for(sio.shutdown(), timeout=5)
    except Exception:
        logger.warning("[bridge] socket.io shutdown did not finish cleanly", exc_info=True)
```

2c. Find the `health_check` function quoted in section 4 and replace it with:

```python
@app.get("/health")
async def health_check():
    """Liveness: the process answers. Never touches the database."""
    return {"status": "ok", "version": "0.1.0"}


# How long the readiness probe waits for the database before answering 503.
READY_TIMEOUT_SECONDS = 3.0


async def database_ready(timeout: float = READY_TIMEOUT_SECONDS) -> bool:
    """True when ``SELECT 1`` on the app's engine succeeds within ``timeout``."""
    # Looked up at call time, like the lifespan does, so tests can point
    # src.database.engine elsewhere.
    from src import database

    async def ping() -> None:
        async with database.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(ping(), timeout=timeout)
        return True
    except Exception as exc:  # TimeoutError included
        logger.warning("[health] database not ready: %s", exc.__class__.__name__)
        return False


@app.get("/health/ready")
async def readiness_check():
    """Readiness: the database answers. 503 when it does not.

    Its own connection rather than the get_db dependency: that dependency
    commits after the response, and a probe must not fail on the way out.
    Used by the compose healthcheck.
    """
    if await database_ready(READY_TIMEOUT_SECONDS):
        return {"status": "ok", "database": "ok"}
    return JSONResponse(status_code=503, content={"status": "unavailable", "database": "unreachable"})
```

Step 3. `self-hosted-cloudapi/src/auth/authentik.py`.

3a. Find:

```python
import hashlib
import base64
import secrets
from typing import Optional, Dict, Any
from urllib.parse import urlencode

import httpx
```

Replace with:

```python
import asyncio
import hashlib
import base64
import logging
import secrets
from typing import Awaitable, Callable, Optional, Dict, Any
from urllib.parse import urlencode

import httpx
```

3b. Find `def _back_channel_headers(` (one occurrence) and insert directly ABOVE it (then two blank lines):

```python
logger = logging.getLogger(__name__)

# Explicit limits for the back-channel calls: 5 s to connect, 10 s for each
# read, write and pool wait. httpx's implicit default is 5 s for everything,
# which is short for a token exchange on a busy Authentik and was never a
# decision anybody made.
AUTHENTIK_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
# Pause before the single retry of a request that could not connect.
RETRY_DELAY_SECONDS = 0.5
# Only failures where the request never reached Authentik are retried: the
# authorization code is single-use, so a request that was sent (a read
# timeout, an error status) must not be repeated.
_RETRYABLE = (httpx.ConnectError, httpx.ConnectTimeout)


async def _with_one_retry(send: Callable[[], Awaitable[httpx.Response]]) -> httpx.Response:
    """Run ``send``; if it could not connect, wait briefly and run it once more."""
    try:
        return await send()
    except _RETRYABLE as exc:
        logger.warning("Authentik connect failed (%s); retrying once", exc.__class__.__name__)
        await asyncio.sleep(RETRY_DELAY_SECONDS)
        return await send()
```

3c. In `exchange_code_for_tokens` find `    async with httpx.AsyncClient() as client:\n        token_data = {` and change
only the first line to `    async with httpx.AsyncClient(timeout=AUTHENTIK_TIMEOUT) as client:`.

3d. In `exchange_code_for_tokens` replace the `client.post(...)` block quoted in section 4 with:

```python
        response = await _with_one_retry(
            lambda: client.post(
                get_authentik_token_url(),
                data=token_data,
                headers=_back_channel_headers(
                    {"Content-Type": "application/x-www-form-urlencoded"}
                ),
            )
        )
        response.raise_for_status()
```

3e. In `get_userinfo` replace the block quoted in section 4 (from `    async with httpx.AsyncClient() as client:` to
`        response.raise_for_status()`) with:

```python
    async with httpx.AsyncClient(timeout=AUTHENTIK_TIMEOUT) as client:
        response = await _with_one_retry(
            lambda: client.get(
                get_authentik_userinfo_url(),
                headers=_back_channel_headers(
                    {"Authorization": f"Bearer {access_token}"}
                ),
            )
        )
        response.raise_for_status()
```

After step 3 there must be no `httpx.AsyncClient()` without `timeout=` left:
`grep -n "AsyncClient()" src/auth/authentik.py` prints nothing.

Step 4. `self-hosted-cloudapi/docker-entrypoint.sh`. Replace the last line
`exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}"` with:

```sh
# --timeout-graceful-shutdown: on SIGTERM uvicorn stops accepting, asks open
# connections to close and then waits for them; without a limit a socket.io
# long-poll or websocket keeps it waiting until Docker's SIGKILL, and the
# lifespan shutdown (stop the retention loop, close the bridge, dispose the
# engine) never runs. 15 s fits inside the api's stop_grace_period (20 s).
# --proxy-headers is uvicorn's default, spelled out; it only trusts
# X-Forwarded-* from FORWARDED_ALLOW_IPS (default 127.0.0.1). Do not widen
# that to "*": WEB_ALLOWED_NETWORKS decides on the client address.
exec uv run uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8085}" \
    --proxy-headers --timeout-graceful-shutdown 15
```

Step 5. `self-hosted-cloudapi/docker-compose.yml`, service `api`. Find (unique, it is the `api` service's tail):

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      auth_server:
        condition: service_healthy
    restart: unless-stopped

  postgres:
```

Replace with:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      auth_server:
        condition: service_healthy
    # /health/ready runs SELECT 1, so "healthy" means the api answers AND
    # reaches its database. The image has no curl; its python does the GET
    # (urlopen raises on a 503, which fails the check). start_period covers
    # db-migrate.sh, which runs before uvicorn starts.
    healthcheck:
      test:
        [
          "CMD",
          "python",
          "-c",
          "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health/ready' % os.environ.get('PORT', '8085'), timeout=5)",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    # Longer than uvicorn's --timeout-graceful-shutdown (15 s, see
    # docker-entrypoint.sh), so the lifespan shutdown finishes before SIGKILL.
    stop_grace_period: 20s
    restart: unless-stopped

  postgres:
```

Step 6. `self-hosted-cloudapi/tests/test_route_table.py`. In `EXPECTED`, find
`    ("/health", ("GET",), "health_check", "APIRoute"),` and add directly below it:

```python
    ("/health/ready", ("GET",), "readiness_check", "APIRoute"),
```

(`test_overlapping_routes_keep_their_order` is unaffected: `/health` does not match `/health/ready`. Checked.)

Step 7. `self-hosted-cloudapi/tests/test_back_channel_host.py`, class `_CapturingClient`. Find:

```python
    last_headers: dict = {}

    async def __aenter__(self):
```

Replace with:

```python
    last_headers: dict = {}

    def __init__(self, *args, **kwargs):
        # authentik.py passes timeout=AUTHENTIK_TIMEOUT (R9).
        pass

    async def __aenter__(self):
```

Step 8. Docs.
- `docs/08-cloud.md`, section "### Database and deploy", last bullet (in the file the bullet starts at column 0;
  the blocks below are indented two spaces only because they sit inside this list). Find:
  ```
  - `Dockerfile`: Python 3.13 slim, `uv sync --frozen`, non-root user. `docker-entrypoint.sh` migrates, then starts
    uvicorn.
  ```
  and replace it with:
  ```
  - `Dockerfile`: Python 3.13 slim, `uv sync --frozen`, non-root user. `docker-entrypoint.sh` migrates, then starts
    uvicorn with a 15 s graceful-shutdown limit. `GET /health` is liveness; `GET /health/ready` also runs
    `SELECT 1` and is the compose healthcheck.
  ```
- `self-hosted-cloudapi/README.md`, section "## API Endpoints": after the "### Main API (ROO_CODE_API_URL)" list
  add:
  ```
  ### Health

  - `GET /health` - Liveness (the process answers; no database access)
  - `GET /health/ready` - Readiness (`SELECT 1` within 3 s; 503 when the database does not answer)
  ```

## 7. Tests to add or change

New file `self-hosted-cloudapi/tests/test_readiness.py` (router + unit level; no browser, no e2e):

```python
"""Readiness, engine settings and Authentik timeouts (R9).

``/health`` only proves the process answers; ``/health/ready`` proves the
database does too, and is what the compose healthcheck calls. The engine
replaces dropped connections (``pool_pre_ping``) and bounds how long a
PostgreSQL connect may take, without passing PostgreSQL-only arguments to
SQLite. Authentik calls carry an explicit timeout and retry a failed connect
once.
"""

import asyncio
from pathlib import Path

import httpx
import pytest
import yaml
from sqlalchemy.ext.asyncio import create_async_engine

import src.database as database
import src.main as main
from src.auth import authentik
from src.database import DB_CONNECT_TIMEOUT_SECONDS, engine_kwargs


# --- /health/ready ------------------------------------------------------------


def test_ready_answers_200_when_the_database_answers(client):
    resp = client.get("/health/ready")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "database": "ok"}


def test_ready_answers_503_when_the_database_is_unreachable(client, monkeypatch, tmp_path):
    # A SQLite file in a directory that does not exist: every connect fails.
    broken = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/missing/dir/db.sqlite")
    monkeypatch.setattr(database, "engine", broken)

    resp = client.get("/health/ready")

    assert resp.status_code == 503
    assert resp.json() == {"status": "unavailable", "database": "unreachable"}


class _HangingEngine:
    """An engine whose connect never completes, like a database that stopped answering."""

    def connect(self):
        return self

    async def __aenter__(self):
        await asyncio.sleep(30)

    async def __aexit__(self, *exc):
        return False


def test_ready_gives_up_after_its_timeout(client, monkeypatch):
    monkeypatch.setattr(database, "engine", _HangingEngine())
    monkeypatch.setattr(main, "READY_TIMEOUT_SECONDS", 0.05)

    resp = client.get("/health/ready")

    assert resp.status_code == 503


def test_liveness_is_unchanged(client):
    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "version": "0.1.0"}


# --- engine arguments ---------------------------------------------------------


def test_sqlite_engine_gets_pre_ping_and_no_postgres_arguments():
    kwargs = engine_kwargs("sqlite+aiosqlite:///:memory:")

    assert kwargs == {"echo": False, "pool_pre_ping": True}


def test_postgres_engine_gets_pool_sizing_and_a_connect_timeout():
    kwargs = engine_kwargs("postgresql+asyncpg://roo:password@postgres:5432/roo_cloud")

    assert kwargs == {
        "echo": False,
        "pool_pre_ping": True,
        "pool_size": 20,
        "max_overflow": 10,
        "connect_args": {"timeout": DB_CONNECT_TIMEOUT_SECONDS},
    }


async def test_both_argument_sets_build_an_engine():
    """create_async_engine rejects unknown arguments at construction time, so
    building one per dialect (no connection is opened) catches a wrong key."""
    for url in ("sqlite+aiosqlite:///:memory:", "postgresql+asyncpg://u:p@localhost:5432/db"):
        engine = create_async_engine(url, **engine_kwargs(url))
        await engine.dispose()


# --- Authentik back channel ---------------------------------------------------


class _Resp:
    def raise_for_status(self):
        return None

    def json(self):
        return {"access_token": "fake", "sub": "fake"}


class _FlakyClient:
    """httpx.AsyncClient stand-in: the first request fails to connect."""

    created_with: list = []
    calls = 0

    def __init__(self, *args, **kwargs):
        _FlakyClient.created_with.append(kwargs)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def _request(self):
        _FlakyClient.calls += 1
        if _FlakyClient.calls == 1:
            raise httpx.ConnectError("connection refused")
        return _Resp()

    async def post(self, url, data=None, headers=None):
        return await self._request()

    async def get(self, url, headers=None):
        return await self._request()


@pytest.fixture
def flaky_httpx(monkeypatch):
    _FlakyClient.created_with = []
    _FlakyClient.calls = 0
    monkeypatch.setattr(authentik.httpx, "AsyncClient", _FlakyClient)
    monkeypatch.setattr(authentik, "RETRY_DELAY_SECONDS", 0)
    return _FlakyClient


async def test_token_exchange_retries_one_failed_connect(flaky_httpx):
    tokens = await authentik.exchange_code_for_tokens("code", "verifier")

    assert tokens["access_token"] == "fake"
    assert flaky_httpx.calls == 2
    assert flaky_httpx.created_with == [{"timeout": authentik.AUTHENTIK_TIMEOUT}]


async def test_userinfo_retries_one_failed_connect(flaky_httpx):
    info = await authentik.get_userinfo("access-token")

    assert info["sub"] == "fake"
    assert flaky_httpx.calls == 2


async def test_a_second_connect_failure_is_raised(flaky_httpx, monkeypatch):
    async def always_refused(self):
        _FlakyClient.calls += 1
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(_FlakyClient, "_request", always_refused)

    with pytest.raises(httpx.ConnectError):
        await authentik.get_userinfo("access-token")
    assert flaky_httpx.calls == 2


def test_authentik_timeout_is_explicit():
    timeout = authentik.AUTHENTIK_TIMEOUT

    assert isinstance(timeout, httpx.Timeout)
    assert timeout.connect == 5.0
    assert timeout.read == 10.0


# --- Shutdown -----------------------------------------------------------------


async def test_closing_the_bridge_with_no_clients_does_not_raise():
    # engine.io's disconnect() of "all clients" calls asyncio.wait([]) on an
    # empty set, which raises; _close_bridge must skip it.
    await main._close_bridge()


async def test_closing_the_bridge_disconnects_every_client(monkeypatch):
    from src.realtime.sio import sio

    closed = []

    class _Socket:
        async def close(self, reason=None, **kwargs):
            closed.append(reason)

    monkeypatch.setattr(sio.eio, "sockets", {"sid-a": _Socket(), "sid-b": _Socket()})

    await main._close_bridge()

    assert len(closed) == 2
    assert sio.eio.sockets == {}


# --- Deployment files ---------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent


def test_entrypoint_bounds_the_graceful_shutdown():
    entrypoint = (ROOT / "docker-entrypoint.sh").read_text()

    assert "--timeout-graceful-shutdown 15" in entrypoint


def test_compose_checks_the_api_through_the_readiness_probe():
    api = yaml.safe_load((ROOT / "docker-compose.yml").read_text())["services"]["api"]

    assert any("/health/ready" in part for part in api["healthcheck"]["test"])
    # Longer than the graceful-shutdown timeout, so the lifespan can finish.
    assert api["stop_grace_period"] == "20s"
```

Why each fails without the fix: the module fails to import (`DB_CONNECT_TIMEOUT_SECONDS`/`engine_kwargs` do not
exist; `authentik.AUTHENTIK_TIMEOUT`, `RETRY_DELAY_SECONDS` and `main._close_bridge` neither). Behaviorally:
`/health/ready` is a 404; no retry happens on `ConnectError`; the entrypoint and compose assertions find nothing.
Changed tests: `tests/test_route_table.py` (step 6) and `tests/test_back_channel_host.py` (step 7), both fail
without their edits once the code changes are in.

## 8. Commands to run (exact, from which directory) and the expected result

All from `self-hosted-cloudapi/`:

1. `uv sync --frozen --extra dev`.
2. Add `tests/test_readiness.py` only: `uv run pytest -q tests/test_readiness.py` -> collection error (ImportError).
3. Apply steps 1-7: `uv run pytest -q tests/test_readiness.py tests/test_back_channel_host.py tests/test_route_table.py`
   -> 19 passed.
4. Wider: `uv run pytest -q tests/test_remote_access.py tests/test_cors_origins.py tests/test_bridge.py tests/test_bridge_path.py`
   -> all pass (they call `/health` and the bridge).
5. Whole suite: `uv run pytest` -> all pass except the two pre-existing `tests/test_metrics_characterization.py`
   failures (present on untouched main).
6. `make lint` -> "All checks passed!".
7. `sh -n docker-entrypoint.sh` -> no output (syntax OK).
8. `AUTH_PG_PASS=x AUTHENTIK_SECRET_KEY=y docker compose -f docker-compose.yml config -q` -> exit 0 (if Docker is
   available).
9. Type check / eslint / prettier: not applicable.

## 9. Do not touch / pitfalls

- Keep `/health` byte-for-byte the same response (`{"status": "ok", "version": "0.1.0"}`); other tests call it.
- Do not change the `/bridge` socket path or `mount_bridge` (do-not-touch).
- Do not pass `pool_size`, `max_overflow` or `connect_args={"timeout": ...}` for SQLite URLs (aiosqlite rejects
  them); `tests/conftest.py` builds its own engine and is not affected, but `src/database.py` is imported by tests
  with a SQLite URL.
- Do not add `--forwarded-allow-ips '*'` / `FORWARDED_ALLOW_IPS=*` (see section 5).
- Keep the `if sio.eio.sockets:` guard: `sio.eio.disconnect()` with no clients raises `ValueError`.
- `stop_grace_period` (20 s) must stay larger than `--timeout-graceful-shutdown` (15 s).
- The python in the healthcheck is the image's `/usr/local/bin/python`; only the standard library is used. The
  image has no curl.
- uvicorn's access log will log the healthcheck GET every 30 s at INFO; acceptable, do not add filtering here.
- Mocks that assert exact call arguments: `tests/test_back_channel_host.py` records headers only; the new
  `_FlakyClient` asserts the constructor kwargs are exactly `{"timeout": authentik.AUTHENTIK_TIMEOUT}`.

## 10. Acceptance checklist (checkboxes)

- [ ] `GET /health/ready` returns 200 `{"status": "ok", "database": "ok"}`, 503 when the DB is unreachable or slow
      (3 s timeout); `/health` unchanged.
- [ ] `engine_kwargs(url)` in `src/database.py`: `pool_pre_ping=True` always; pool sizing and asyncpg connect
      timeout only for PostgreSQL.
- [ ] Authentik calls use `httpx.AsyncClient(timeout=AUTHENTIK_TIMEOUT)` and retry once on connect errors only.
- [ ] Lifespan shutdown disconnects socket.io clients and calls `sio.shutdown()` (bounded, never raises).
- [ ] Entrypoint has `--proxy-headers --timeout-graceful-shutdown 15`; compose `api` has the readiness healthcheck
      and `stop_grace_period: 20s`.
- [ ] Route table and back-channel test doubles updated; new tests pass; no new failures; `make lint` passes.
- [ ] Docs updated (docs/08-cloud.md, README.md); `ai_plans/` note added.

## 11. Commit, changeset and PR text

- Commit title: `fix(cloudapi): readiness probe, explicit timeouts and a bounded graceful shutdown (R9)`
- Commit body:
  ```
  /health never touched the database and compose had no healthcheck for
  the api, so a lost database went unnoticed. GET /health/ready runs
  SELECT 1 within 3 s (503 otherwise) and is now the api's compose
  healthcheck; /health is unchanged.

  The engine pings pooled connections before use and, on PostgreSQL,
  gives up connecting after 10 s. Authentik token and userinfo calls have
  an explicit httpx.Timeout and retry once when they could not connect.

  uvicorn waited forever for open socket.io connections on SIGTERM, so
  Docker killed it before the lifespan shutdown ran. The entrypoint now
  passes --timeout-graceful-shutdown 15 (stop_grace_period 20s), and the
  lifespan disconnects socket.io clients and stops the server.

  Tests: tests/test_readiness.py; route table and back-channel test double
  updated.
  ```
  End with the attribution lines the session requires.
- Changeset: none (cloud API only).
- `ai_plans/<today as YYYY-MM-DD>_cloud-readiness-and-shutdown.md`: title "Cloud: readiness, timeouts, graceful
  shutdown (R9)", Status, Touched files, Problem, Change (five bullets matching section 1), Tests, Decisions (no
  shared AsyncClient, no Dockerfile HEALTHCHECK, no forwarded-allow-ips), Open check (the `uv run` signal
  forwarding hypothesis and its docker command).
- PR body outline: Problem, Change, Decisions, How to verify on a real stack (`docker compose ps` shows
  `api ... (healthy)`; `docker compose stop postgres` flips it to unhealthy within ~90 s; `docker compose stop api`
  logs "Roo Cloud API stopped"), Tests, Pre-existing failures. End with the PR attribution line.

## 12. If stuck

- If `tests/test_readiness.py::test_ready_gives_up_after_its_timeout` hangs instead of returning 503, report it
  (it means `READY_TIMEOUT_SECONDS` is read at definition time: check that `readiness_check` passes
  `READY_TIMEOUT_SECONDS` explicitly to `database_ready`).
- If `create_async_engine` rejects `pool_pre_ping` for SQLite, report the error and SQLAlchemy version; do not
  drop `pool_pre_ping` for PostgreSQL.
- If the Docker check in step 8 fails for a reason unrelated to the `api` edits (missing env vars), report the
  message and continue; the YAML test in `tests/test_readiness.py` still validates the structure.
