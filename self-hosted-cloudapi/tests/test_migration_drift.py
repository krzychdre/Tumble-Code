"""Guard against model and migration drift (CAPI-M10).

The schema has two sources that must agree: the ORM models (``create_all``
builds a FRESH database from them, see src/db_bootstrap.py) and the migration
chain (it evolves every existing deployment). Nothing checked that they end in
the same place, so a model change shipped without its migration only showed up
on a production database.

These tests run on SQLite only (no Postgres in CI, owner decision 23):

* ``classify_and_seed`` in its three states, called directly.
* ``db-migrate.sh`` end to end in each state, with a ``uv`` shim that runs the
  test interpreter, so the real shell script decides what alembic does.
* The drift check: build the pre-Alembic schema from a frozen snapshot
  (tests/fixtures/baseline_schema_sqlite.sql), run the migrations to head,
  and compare the result with ``Base.metadata`` using alembic's own
  ``compare_metadata``. Adding a column, table or index to a model without a
  migration turns ``test_migrations_reach_the_models`` red.

What SQLite cannot check (Postgres only, untested here):

* b2c3d4e5f6a7 (datetime_timezone) cannot run on SQLite: it is a plain
  ``ALTER COLUMN ... TYPE`` without a dialect guard or batch mode, and SQLite
  has no such statement. It is also invisible there (DateTime() and
  DateTime(timezone=True) are both DATETIME), so the drift check starts the
  chain at b2c3d4e5f6a7 instead of a1b2c3d4e5f6.
* The Postgres branches of data migrations: the duplicate cleanup
  (``DELETE ... USING``) in d4e5f6a7b8c9, and the ``conn.dialect.name ==
  "postgresql"`` SQL in e1f2a3b4c5d6 and f6a7b8c9d0e1. Their SQLite branches
  run here.
* Differences compare_metadata does not see on SQLite: the timezone flag of
  DateTime, and a length added to a plain String (VARCHAR vs VARCHAR(64)).
  Checked by hand to be detected: a new column, table or index, a changed
  type, nullability or server default, and a new foreign key.
"""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect
from sqlalchemy.ext.asyncio import create_async_engine

from src.database import Base
from src.db_bootstrap import classify_and_seed

PROJECT_DIR = Path(__file__).resolve().parent.parent
BASELINE_SQL = PROJECT_DIR / "tests" / "fixtures" / "baseline_schema_sqlite.sql"

BASELINE_REVISION = "a1b2c3d4e5f6"
# The first revision after the Postgres-only datetime migration; see the
# module docstring.
SQLITE_START_REVISION = "b2c3d4e5f6a7"

# Settings the app refuses to start without. The env file carries them to the
# alembic and bootstrap subprocesses.
_REQUIRED_ENV = {
    "SECRET_KEY": "test-secret-key-for-the-test-suite-only",
    "API_BASE_URL": "http://testserver",
    "AUTHENTIK_BASE_URL": "http://authentik-test.local",
    "AUTHENTIK_CLIENT_ID": "test-client-id",
    "AUTHENTIK_REDIRECT_URI": "http://testserver/auth/clerk/callback",
    "JWT_SECRET": "test-jwt-secret-please-ignore-0123456789",
}

# Differences between the migrated database and the models that exist today.
# Each entry is (operation, table, name); see _drift_key. Empty: an entry may
# only be added with the reason it cannot be closed yet, and
# test_migrated_database_matches_the_models_exactly must then carry a strict
# xfail until it is.
#
# The last entry, uq_task_messages_task_ts, was closed by declaring it in the
# model as the unique INDEX migration d4e5f6a7b8c9 creates, instead of a
# UniqueConstraint (a FRESH database used to get a table constraint where
# every migrated one has an index).
KNOWN_DRIFT: frozenset = frozenset()


def _head_revision() -> str:
    config = Config(str(PROJECT_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(PROJECT_DIR / "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()


def _load_baseline(db_file: Path) -> None:
    with sqlite3.connect(db_file) as conn:
        conn.executescript(BASELINE_SQL.read_text())


def _tables(db_file: Path) -> set[str]:
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def _scalar(db_file: Path, sql: str):
    with sqlite3.connect(db_file) as conn:
        row = conn.execute(sql).fetchone()
    return row[0] if row else None


def _alembic_version(db_file: Path) -> str | None:
    return _scalar(db_file, "SELECT version_num FROM alembic_version")


def _drift_key(diff) -> tuple:
    """A comparable (operation, table, name) for one compare_metadata entry.

    Column changes come back as a list of tuples, everything else as one tuple
    whose second item is the schema object."""
    if isinstance(diff, list):
        op, _schema, table, column, *_ = diff[0]
        return (op, table, column)
    op, obj = diff[0], diff[1]
    table = getattr(obj, "table", None)
    table_name = table.name if table is not None else getattr(obj, "name", None)
    return (op, table_name, getattr(obj, "name", None) or str(obj))


def _drift(db_file: Path) -> list:
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn, opts={"compare_type": True, "compare_server_default": True}
            )
            return compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()


@pytest.fixture
def migrate_env(tmp_path):
    """Run alembic, the bootstrap and db-migrate.sh against one SQLite file.

    Yields (db_file, run) where ``run(*argv)`` executes a command in the
    project directory with the test interpreter and the database's env file.
    """
    db_file = tmp_path / "cloudapi.db"
    env_file = tmp_path / "cloudapi.env"
    lines = dict(_REQUIRED_ENV, DATABASE_URL=f"sqlite+aiosqlite:///{db_file}")
    env_file.write_text("".join(f"{key}={value}\n" for key, value in lines.items()))

    # db-migrate.sh calls `uv run python ...` and `uv run alembic ...`. The
    # shim runs both with the interpreter running the tests, so the script
    # needs neither uv nor a network.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    shim = bin_dir / "uv"
    shim.write_text(
        "#!/bin/sh\n"
        '[ "$1" = run ] || { echo "uv shim: unexpected $*" >&2; exit 2; }\n'
        "shift\n"
        'tool="$1"; shift\n'
        'case "$tool" in\n'
        f'  python) exec "{sys.executable}" "$@" ;;\n'
        f'  alembic) exec "{sys.executable}" -m alembic "$@" ;;\n'
        '  *) echo "uv shim: unexpected tool $tool" >&2; exit 2 ;;\n'
        "esac\n"
    )
    shim.chmod(0o755)

    # The conftest exports the settings as environment variables, which would
    # win over the env file; drop them so the file decides.
    env = {
        k: v for k, v in os.environ.items() if k not in {*_REQUIRED_ENV, "DATABASE_URL"}
    }
    env["CLOUDAPI_ENV_FILE"] = str(env_file)
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"

    def run(*argv: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            list(argv),
            cwd=PROJECT_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )

    yield db_file, run


def _alembic(run, *args: str) -> None:
    result = run(sys.executable, "-m", "alembic", *args)
    assert result.returncode == 0, result.stderr


# --- classify_and_seed --------------------------------------------------------


@pytest.fixture
async def file_engine(tmp_path):
    db_file = tmp_path / "classify.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}")
    yield db_file, engine
    await engine.dispose()


async def test_an_empty_database_is_fresh_and_gets_every_table(file_engine):
    db_file, engine = file_engine

    assert await classify_and_seed(engine) == "FRESH"

    assert _tables(db_file) == set(Base.metadata.tables)


async def test_a_stale_alembic_version_without_tables_is_fresh(file_engine):
    # A failed earlier bootstrap: the no-op baseline was stamped, then the
    # first ALTER crashed. It must self-heal like an empty database.
    db_file, engine = file_engine
    with sqlite3.connect(db_file) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        conn.execute("INSERT INTO alembic_version VALUES (?)", (BASELINE_REVISION,))

    assert await classify_and_seed(engine) == "FRESH"

    assert _tables(db_file) == set(Base.metadata.tables) | {"alembic_version"}


async def test_tables_without_alembic_are_legacy_and_left_alone(file_engine):
    db_file, engine = file_engine
    _load_baseline(db_file)
    before = _tables(db_file)

    assert await classify_and_seed(engine) == "LEGACY"

    # No DDL: the tables later migrations add are still missing.
    assert _tables(db_file) == before
    assert "task_relations" not in before


async def test_tables_with_alembic_are_managed_and_left_alone(file_engine):
    db_file, engine = file_engine
    _load_baseline(db_file)
    with sqlite3.connect(db_file) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        conn.execute("INSERT INTO alembic_version VALUES (?)", (SQLITE_START_REVISION,))
    before = _tables(db_file)

    assert await classify_and_seed(engine) == "MANAGED"

    assert _tables(db_file) == before


# --- db-migrate.sh end to end ---------------------------------------------------


def _seed_legacy_rows(db_file: Path) -> None:
    """A user with one task and two messages, in the pre-Alembic schema."""
    with sqlite3.connect(db_file) as conn:
        conn.execute(
            "INSERT INTO users (id, authentik_id, email) VALUES ('user_1', 'ak_1', 'a@b.c')"
        )
        conn.execute("INSERT INTO tasks (id, user_id) VALUES ('task_1', 'user_1')")
        conn.executemany(
            "INSERT INTO task_messages (id, task_id, message_data) VALUES (?, 'task_1', ?)",
            [
                ("msg_1", '{"ts": 1000, "type": "say", "say": "text", "text": "hello"}'),
                ("msg_2", '{"ts": 2000, "type": "say", "say": "text", "text": "done"}'),
            ],
        )


def test_migrate_script_on_an_empty_database_builds_and_stamps_head(migrate_env):
    db_file, run = migrate_env

    result = run("sh", "./db-migrate.sh")

    assert result.returncode == 0, result.stderr
    assert "DB state: FRESH" in result.stdout
    assert _alembic_version(db_file) == _head_revision()
    assert _tables(db_file) == set(Base.metadata.tables) | {"alembic_version"}


def test_migrate_script_on_a_stale_alembic_version_rebuilds_and_restamps(migrate_env):
    db_file, run = migrate_env
    with sqlite3.connect(db_file) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        conn.execute("INSERT INTO alembic_version VALUES (?)", (BASELINE_REVISION,))

    result = run("sh", "./db-migrate.sh")

    assert result.returncode == 0, result.stderr
    assert "DB state: FRESH" in result.stdout
    assert _alembic_version(db_file) == _head_revision()


def test_migrate_script_on_a_legacy_database_stamps_the_baseline_first(migrate_env):
    """LEGACY adopts the baseline without recreating any table.

    The following `upgrade head` starts with the datetime migration, which is
    Postgres-only (module docstring), so on SQLite the script stops there;
    the chain after it is covered by the MANAGED and drift tests."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _seed_legacy_rows(db_file)
    before = _tables(db_file)

    result = run("sh", "./db-migrate.sh")

    assert "DB state: LEGACY" in result.stdout
    assert _alembic_version(db_file) == BASELINE_REVISION
    assert _tables(db_file) == before | {"alembic_version"}
    assert _scalar(db_file, "SELECT count(*) FROM task_messages") == 2
    # The expected SQLite stop, not some other failure.
    assert result.returncode != 0
    assert "ALTER TABLE authentik_state_store ALTER COLUMN created_at TYPE" in result.stderr


def test_migrate_script_on_a_managed_database_upgrades_to_head(migrate_env):
    db_file, run = migrate_env
    _load_baseline(db_file)
    _seed_legacy_rows(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)

    result = run("sh", "./db-migrate.sh")

    assert result.returncode == 0, result.stderr
    assert "DB state: MANAGED" in result.stdout
    assert _alembic_version(db_file) == _head_revision()
    # The rows survived, and the SQLite branch of the data migrations ran:
    # f6a7b8c9d0e1 rolled the two messages up into the task row.
    assert _scalar(db_file, "SELECT count(*) FROM task_messages") == 2
    assert _scalar(db_file, "SELECT message_count FROM tasks WHERE id = 'task_1'") == 2


# --- Drift ----------------------------------------------------------------------


@pytest.fixture
def migrated_db(migrate_env):
    """The pre-Alembic snapshot, migrated to head."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "head")
    assert _alembic_version(db_file) == _head_revision()
    return db_file


def test_migrations_reach_the_models(migrated_db):
    """A model change without a migration (or the reverse) turns this red.

    Anything listed here is a difference between what `alembic upgrade head`
    builds and what the models declare: write the migration that closes it.
    """
    unexpected = [d for d in _drift(migrated_db) if _drift_key(d) not in KNOWN_DRIFT]

    assert unexpected == []


def test_migrated_database_matches_the_models_exactly(migrated_db):
    assert _drift(migrated_db) == []


def test_known_drift_is_still_present(migrated_db):
    """Each KNOWN_DRIFT entry must still be real, so the list only shrinks."""
    found = {_drift_key(d) for d in _drift(migrated_db)}

    assert KNOWN_DRIFT <= found


def test_a_fresh_database_has_no_drift(tmp_path):
    """create_all is the other road to head; it matches the models trivially,
    which pins that compare_metadata itself reports nothing spurious here."""
    db_file = tmp_path / "fresh.db"
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()

    assert _drift(db_file) == []
