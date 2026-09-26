"""Configuration and bootstrap consistency (CAPI-M7).

- Logging is configured once, at a level taken from LOG_LEVEL, and the startup
  banner goes through a logger instead of print().
- The app no longer runs create_all on every start: the schema step belongs to
  db-migrate.sh (src/db_bootstrap.py). A startup create_all built the full
  schema without an alembic_version row, so a later `make migrate` classified
  the database as LEGACY and the table-creating migrations then failed on
  tables that already existed.
- /api/extension/credit-balance keeps answering {"balance": 0} (the extension
  calls it), without the CREDIT_SYSTEM_ENABLED switch that changed nothing.
- alembic/env.py reads the database URL through the app settings, so it
  honours CLOUDAPI_ENV_FILE and the same .env rules as the app.
"""

import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.ext.asyncio import create_async_engine

from config.settings import Settings, settings

PROJECT_DIR = Path(__file__).resolve().parent.parent

_REQUIRED = dict(
    database_url="sqlite+aiosqlite://",
    secret_key="test-secret-key-for-the-test-suite-only",
    api_base_url="http://testserver",
    authentik_base_url="http://authentik-test.local",
    authentik_client_id="test-client-id",
    authentik_redirect_uri="http://testserver/auth/clerk/callback",
    jwt_secret="test-jwt-secret-please-ignore-0123456789",
)


# --- Logging -----------------------------------------------------------------


def test_log_level_defaults_to_info_and_is_normalized():
    assert Settings(**_REQUIRED).log_level == "INFO"
    assert Settings(**_REQUIRED, log_level="debug").log_level == "DEBUG"


def test_an_unknown_log_level_stops_startup():
    with pytest.raises(ValueError, match="LOG_LEVEL"):
        Settings(**_REQUIRED, log_level="loud")


@pytest.fixture
def bare_root_logger():
    """The root logger with no handlers, restored afterwards."""
    root = logging.getLogger()
    saved_handlers, saved_level = root.handlers[:], root.level
    root.handlers = []
    try:
        yield root
    finally:
        root.handlers = saved_handlers
        root.setLevel(saved_level)


def test_configure_logging_sets_the_level_and_adds_one_handler(bare_root_logger):
    from src.logging_setup import configure_logging

    configure_logging("WARNING")
    configure_logging("DEBUG")

    assert bare_root_logger.level == logging.DEBUG
    # pytest adds its own capture handlers to the root; count only ours.
    ours = [h for h in bare_root_logger.handlers if type(h) is logging.StreamHandler]
    assert len(ours) == 1


# --- Startup -----------------------------------------------------------------


@pytest.fixture
async def empty_engine(monkeypatch, tmp_path):
    """Point the lifespan at an empty database. A file, not :memory:, because
    the lifespan disposes the engine on shutdown, which would drop an
    in-memory database together with whatever startup created in it."""
    import src.database

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'startup.db'}")
    monkeypatch.setattr(src.database, "engine", engine)
    monkeypatch.setattr(settings, "retention_sweep_enabled", False)
    yield engine
    await engine.dispose()


async def _run_lifespan():
    from src.main import app, lifespan

    async with lifespan(app):
        pass


async def test_startup_banner_goes_through_a_logger(empty_engine, caplog, capsys):
    with caplog.at_level(logging.INFO, logger="src.main"):
        await _run_lifespan()

    messages = [r.getMessage() for r in caplog.records if r.name == "src.main"]
    assert any("started" in m for m in messages)
    assert any(settings.api_base_url in m for m in messages)
    assert not any("Credits" in m for m in messages)
    # Nothing printed to stdout any more.
    assert capsys.readouterr().out == ""


async def test_startup_does_not_create_tables(empty_engine):
    await _run_lifespan()

    async with empty_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
    assert tables == []


# --- Credit balance ----------------------------------------------------------


def test_credit_balance_answers_zero(client):
    from src.dependencies import get_current_user
    from src.main import app

    app.dependency_overrides[get_current_user] = lambda: {"user_id": "user_1"}
    try:
        response = client.get("/api/extension/credit-balance")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    assert response.json() == {"balance": 0}


def test_credit_balance_requires_a_signed_in_user(client):
    assert client.get("/api/extension/credit-balance").status_code == 401


def test_the_retired_credit_switch_is_ignored():
    # Old .env files still carry CREDIT_SYSTEM_ENABLED; extra="ignore" keeps
    # them loading.
    loaded = Settings(**_REQUIRED, CREDIT_SYSTEM_ENABLED="true")
    assert not hasattr(loaded, "credit_system_enabled")


# --- Alembic ------------------------------------------------------------------


def test_alembic_reads_the_database_url_from_the_app_settings(tmp_path):
    """`alembic stamp head` lands in the database the env file names."""
    db_file = tmp_path / "alembic.db"
    env_file = tmp_path / "cloudapi.env"
    lines = {key.upper(): value for key, value in _REQUIRED.items()}
    lines["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_file}"
    env_file.write_text("".join(f"{key}={value}\n" for key, value in lines.items()))

    env = {k: v for k, v in os.environ.items() if k not in {k.upper() for k in _REQUIRED}}
    env["CLOUDAPI_ENV_FILE"] = str(env_file)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "stamp", "head"],
        cwd=PROJECT_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert db_file.exists()
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        assert "alembic_version" in inspect(engine).get_table_names()
    finally:
        engine.dispose()
