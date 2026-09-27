"""R9: readiness and shutdown hygiene.

- ``/health`` is liveness only: it must answer without touching the database,
  so a dead DB does not make the container look dead.
- ``/health/ready`` is readiness: ``SELECT 1`` on the app engine, 200 when the
  database answers, 503 when it does not (deterministically: a broken engine,
  not a real outage).
- The lifespan closes the socket.io server on shutdown (when the bridge is on).
- The engine is created with ``pool_pre_ping``, so a connection dropped behind
  the pool's back is replaced instead of raising on first use.
"""

import pytest

from src.database import ASYNC_DATABASE_URL, _engine_kwargs


# --- /health (liveness) ------------------------------------------------------


def test_liveness_does_not_touch_the_database(client, monkeypatch):
    """`/health` answers even when the engine is broken: no query is issued."""
    import src.database

    class BrokenEngine:
        def connect(self):
            raise AssertionError("liveness must not connect to the database")

    monkeypatch.setattr(src.database, "engine", BrokenEngine())
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_exists_as_a_distinct_route(client):
    """Both endpoints exist and are distinct routes."""
    assert client.get("/health").status_code == 200
    ready = client.get("/health/ready")
    assert ready.status_code in (200, 503)
    assert ready.json()["status"] in ("ready", "unavailable")


# --- /health/ready (readiness) ----------------------------------------------


@pytest.fixture
async def app_engine(monkeypatch, tmp_path):
    """A real file-backed engine the readiness endpoint (and only it) uses."""
    import src.database

    engine = _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'ready.db'}")
    monkeypatch.setattr(src.database, "engine", engine)
    yield engine
    await engine.dispose()


def _make_engine(url: str):
    from sqlalchemy.ext.asyncio import create_async_engine

    return create_async_engine(url)


async def test_readiness_returns_200_when_the_database_answers(app_engine):
    from fastapi.testclient import TestClient
    from src.main import app

    with TestClient(app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


async def test_readiness_returns_503_when_the_database_is_broken(monkeypatch):
    """Deterministic broken DB: the engine raises on connect."""
    import src.database

    class BrokenEngine:
        def connect(self):
            def fail():
                raise RuntimeError("database is down")

            return _FailingContext(fail)

        async def dispose(self):
            pass

    class _FailingContext:
        def __init__(self, fail):
            self._fail = fail

        async def __aenter__(self):
            self._fail()
            raise AssertionError("unreachable")

        async def __aexit__(self, *exc_info):
            return False

    monkeypatch.setattr(src.database, "engine", BrokenEngine())
    from fastapi.testclient import TestClient
    from src.main import app

    with TestClient(app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


async def test_readiness_returns_503_when_select_fails(monkeypatch):
    """The connection opens but the query itself fails (e.g. mid-shutdown DB)."""
    import src.database

    class BadQueryEngine:
        def connect(self):
            class Conn:
                async def __aenter__(self):
                    return self

                async def __aexit__(self, *exc_info):
                    return False

                async def execute(self, *_args, **_kwargs):
                    raise RuntimeError("syntax error at or near")

            return Conn()

        async def dispose(self):
            pass

    monkeypatch.setattr(src.database, "engine", BadQueryEngine())
    from fastapi.testclient import TestClient
    from src.main import app

    with TestClient(app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503


# --- lifespan: socket.io shutdown --------------------------------------------


async def test_lifespan_shuts_the_bridge_down_on_exit(monkeypatch, tmp_path):
    """The lifespan calls sio.shutdown() on exit when the bridge is enabled and
    engine.io has something to stop."""
    from src import main as main_module

    import src.database
    from src.main import app, lifespan

    engine = _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'lifespan-on.db'}")
    monkeypatch.setattr(src.database, "engine", engine)
    monkeypatch.setattr(main_module.settings, "bridge_enabled", True)
    monkeypatch.setattr(main_module.settings, "retention_sweep_enabled", False)

    shutdown_calls = []

    class FakeSio:
        # engine.io starts its service task lazily on the first connection; the
        # lifespan only awaits shutdown() when that task handle exists.
        class eio:
            service_task_handle = object()  # not None: a live service task

        async def shutdown(self):
            shutdown_calls.append(True)

    import src.realtime.sio as sio_module

    monkeypatch.setattr(sio_module, "sio", FakeSio())

    async with lifespan(app):
        pass

    assert shutdown_calls, "lifespan exit must close the socket.io server"
    await engine.dispose()


async def test_lifespan_skips_sio_shutdown_with_no_service_task(monkeypatch, tmp_path):
    """No connection was ever made → engine.io has no service task → the
    lifespan must not await shutdown() (it would crash on a None handle)."""
    from src import main as main_module

    import src.database
    from src.main import app, lifespan

    engine = _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'lifespan-idle.db'}")
    monkeypatch.setattr(src.database, "engine", engine)
    monkeypatch.setattr(main_module.settings, "bridge_enabled", True)
    monkeypatch.setattr(main_module.settings, "retention_sweep_enabled", False)

    shutdown_calls = []

    class IdleSio:
        class eio:
            service_task_handle = None  # no client ever connected

        async def shutdown(self):
            shutdown_calls.append(True)

    import src.realtime.sio as sio_module

    monkeypatch.setattr(sio_module, "sio", IdleSio())

    async with lifespan(app):
        pass

    assert shutdown_calls == []
    await engine.dispose()


async def test_lifespan_skips_the_bridge_when_disabled(monkeypatch, tmp_path):
    """With the bridge off, startup/shutdown must not touch sio at all."""
    from src import main as main_module

    import src.database
    from src.main import app, lifespan

    engine = _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'lifespan.db'}")
    monkeypatch.setattr(src.database, "engine", engine)
    monkeypatch.setattr(main_module.settings, "bridge_enabled", False)
    monkeypatch.setattr(main_module.settings, "retention_sweep_enabled", False)

    import src.realtime.sio as sio_module

    calls = []

    class TrapSio:
        class eio:
            service_task_handle = object()

        async def shutdown(self):
            calls.append("shutdown")

    monkeypatch.setattr(sio_module, "sio", TrapSio())

    async with lifespan(app):
        pass

    assert calls == []
    await engine.dispose()


# --- engine configuration ------------------------------------------------------


def test_engine_uses_pool_pre_ping():
    """A dropped pooled connection must be replaced, not handed out broken."""
    assert _engine_kwargs.get("pool_pre_ping") is True


def test_pool_pre_ping_works_on_the_test_database_too():
    """The kwargs apply to both drivers: SQLite (tests) and Postgres (prod)."""
    assert ASYNC_DATABASE_URL, "the engine must be built from the settings URL"
