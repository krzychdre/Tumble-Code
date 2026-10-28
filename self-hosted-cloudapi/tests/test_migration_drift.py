"""Guard against model and migration drift (CAPI-M10).

The schema has two sources that must agree: the ORM models (``create_all``
builds a FRESH database from them, see src/db_bootstrap.py) and the migration
chain (it evolves every existing deployment). Nothing checked that they end in
the same place, so a model change shipped without its migration only showed up
on a production database.

These tests run on SQLite only (the suite runs on SQLite, owner decision 23;
only tests/test_recall_pg.py has a Postgres lane):

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
* a9b0c1d2e3f4, which renames Postgres' default name of the parent-task
  foreign key, and b2c3d4e5f6a7 skipping provider_configs on a create_all
  database (both checked by hand on PostgreSQL 16.15).
* Differences compare_metadata does not see on SQLite: the timezone flag of
  DateTime, a length added to a plain String (VARCHAR vs VARCHAR(64)), and
  an index on an expression (uq_projects_tenant_name, lower(name)), which
  SQLite's reflection skips with a warning; the data migration test of
  d3e4f5a6b7c8 checks that index by hitting it.
  Checked by hand to be detected: a new column, table or index, a changed
  type, nullability or server default, and a new foreign key.
* The WHERE of a partial index (ix_tasks_user_roots, ix_tasks_org_roots):
  postgresql_where only, and compare_metadata ignores it on Postgres too.
  Checked by hand on PostgreSQL 16.15 for f1a2b3c4d5e6 and create_all.
"""

import json
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
from src.models import RETIRED_TABLES, include_name
from src.services.model_attribution import LABEL_MAX_BYTES
from src.services.projects import folder_key
from src.services.telemetry_vocab import event_columns, parse_event_props

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
    "AUTHENTIK_API_TOKEN": "test-authentik-api-token-0123456789",
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
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    # The same filter alembic/env.py gives autogenerate: a
                    # retired table stays in the database but has no model.
                    "include_name": include_name,
                },
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
                (
                    "msg_1",
                    '{"ts": 1000, "type": "say", "say": "text", "text": "hello"}',
                ),
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
    assert (
        "ALTER TABLE authentik_state_store ALTER COLUMN created_at TYPE"
        in result.stderr
    )


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
    # A deployment that predates error reports gets their table on upgrade.
    assert "error_reports" in _tables(db_file)
    # ...and the LLM exchange recording tables.
    assert {"llm_exchanges", "llm_blobs", "dataset_settings"} <= set(_tables(db_file))


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


def test_retired_tables_are_kept_in_the_database_but_have_no_model(migrated_db):
    """provider_configs (the LLM proxy routing table) lost its last reader when
    the cloud proxy provider was removed; its ORM model was deleted in D6.

    The table itself is not dropped: no migration removes it, so any rows an
    existing deployment still holds survive, and the drift check (like
    autogenerate in alembic/env.py) skips it instead of asking for a drop."""
    assert "provider_configs" in RETIRED_TABLES
    assert RETIRED_TABLES.isdisjoint(Base.metadata.tables)
    assert RETIRED_TABLES <= _tables(migrated_db)
    assert include_name("provider_configs", "table", {}) is False
    assert include_name("tasks", "table", {}) is True


# --- Data migrations ------------------------------------------------------------


def test_client_kind_backfill_marks_the_clis_records_and_tasks(migrate_env):
    """e7f8a9b0c1d2 adds client_kind and marks what the CLI sent: an explicit
    clientKind wins, else the CLI's editor name ("wrapper|cli|..."); everything
    else, and every task without a CLI event of its own user, stays "vscode"."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "d6e7f8a9b0c1")

    cli_editor = "wrapper|cli|cli|0.2.0"
    events = {
        "evt_cli_kind": {"clientKind": "cli", "taskId": "task_cli"},
        "evt_cli_editor": {"editorName": cli_editor, "taskId": "task_old_cli"},
        "evt_kind_wins": {
            "clientKind": "vscode",
            "editorName": cli_editor,
            "taskId": "task_code",
        },
        "evt_code": {"editorName": "Visual Studio Code", "taskId": "task_code"},
        # Mentions "cli" but is neither: parsed and left alone.
        "evt_mention": {"editorName": "Visual Studio Code", "note": "clicked"},
        "evt_foreign": {"clientKind": "cli", "taskId": "task_foreign"},
    }
    with sqlite3.connect(db_file) as conn:
        conn.executemany(
            "INSERT INTO users (id, authentik_id, email) VALUES (?, ?, ?)",
            [("user_1", "ak_1", "a@b.c"), ("user_2", "ak_2", "d@e.f")],
        )
        conn.executemany(
            "INSERT INTO tasks (id, user_id) VALUES (?, 'user_1')",
            [("task_cli",), ("task_old_cli",), ("task_code",), ("task_foreign",)],
        )
        conn.executemany(
            "INSERT INTO telemetry_events (id, user_id, event_type, task_id, properties) "
            "VALUES (?, ?, 'LLM Completion', ?, ?)",
            [
                (
                    row_id,
                    "user_2" if row_id == "evt_foreign" else "user_1",
                    props.get("taskId"),
                    json.dumps(props),
                )
                for row_id, props in events.items()
            ]
            + [("evt_broken", "user_1", None, "{cli not json")],
        )
        conn.executemany(
            "INSERT INTO error_reports (id, user_id, category, summary, signature, occurred_at, created_at, payload) "
            "VALUES (?, 'user_1', 'api_error', 's', 'sig', '2026-10-01', '2026-10-01', ?)",
            [
                ("rep_cli", json.dumps({"editorName": cli_editor})),
                ("rep_code", json.dumps({"editorName": "Visual Studio Code"})),
            ],
        )
        conn.executemany(
            "INSERT INTO llm_exchanges (id, user_id, task_id, sequence, occurred_at, created_at, status, issues, payload) "
            "VALUES (?, 'user_1', 'task_cli', 0, '2026-10-01', '2026-10-01', 'completed', '', ?)",
            [
                ("ex_cli", json.dumps({"clientKind": "cli"})),
                ("ex_code", json.dumps({"clientKind": "vscode"})),
            ],
        )

    _alembic(run, "upgrade", "head")

    def kinds(table):
        with sqlite3.connect(db_file) as conn:
            return dict(conn.execute(f"SELECT id, client_kind FROM {table}").fetchall())

    assert kinds("telemetry_events") == {
        "evt_cli_kind": "cli",
        "evt_cli_editor": "cli",
        "evt_kind_wins": "vscode",
        "evt_code": "vscode",
        "evt_mention": "vscode",
        "evt_foreign": "cli",
        "evt_broken": "vscode",
    }
    assert kinds("error_reports") == {"rep_cli": "cli", "rep_code": "vscode"}
    assert kinds("llm_exchanges") == {"ex_cli": "cli", "ex_code": "vscode"}
    # task_foreign's only CLI event is another user's: not evidence.
    assert kinds("tasks") == {
        "task_cli": "cli",
        "task_old_cli": "cli",
        "task_code": "vscode",
        "task_foreign": "vscode",
    }


def test_event_figure_backfill_stores_what_ingest_stores(migrate_env):
    """e8f9a0b1c2d3 fills the figure columns of every stored completion and
    embedding with what ingest stamps on a new event of that payload
    (telemetry_vocab.event_columns); a payload that is not a JSON object reads
    as an empty one, and any other event keeps NULLs. Hostile payloads stored
    before the bounds do not stop it. More rows than one batch, so the walk
    crosses a batch boundary."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "d4e5f6a7b8c1")

    completion = "LLM Completion"
    events = {
        "evt_full": (
            completion,
            json.dumps(
                {
                    "taskId": "t1",
                    "modelId": "glm",
                    "apiProvider": "zai",
                    "mode": "code",
                    "inputTokens": 1000,
                    "outputTokens": 20,
                    "cacheReadTokens": 300,
                    "cacheWriteTokens": 40,
                    "cost": 0.25,
                    "durationMs": 1500,
                    "completionKind": "memory",
                    "usageReported": False,
                }
            ),
        ),
        "evt_odd": (
            completion,
            json.dumps(
                {
                    "modelId": "",
                    "inputTokens": "900",
                    "outputTokens": True,
                    "cost": "1.5",
                    "durationMs": 1500.0,
                    "completionKind": 5,
                }
            ),
        ),
        # What json.dumps writes for a non-finite float, and Postgres' jsonb
        # would refuse.
        "evt_nan": (
            completion,
            '{"modelId": "m", "inputTokens": NaN, "outputTokens": Infinity, '
            '"cost": -Infinity, "durationMs": 1e999}',
        ),
        # What a hostile client could store before the bounds: figures
        # past BIGINT or negative, names that are no strings or that hold a
        # NUL or a lone surrogate (JSON escapes, decoded by the backfill).
        "evt_hostile": (
            completion,
            '{"modelId": "evil\\u0000model", "apiProvider": "\\ud800zai", '
            '"mode": {"a": 1}, "completionKind": 12345, '
            '"inputTokens": 10000000000000000000, "outputTokens": -1e12, '
            '"cacheReadTokens": 1e19, "cost": 1e300, "durationMs": -1}',
        ),
        "evt_hostile_embed": (
            "Embedding Usage",
            json.dumps({"promptTokens": 10**19, "source": ["x"]}),
        ),
        "evt_oversized": (
            completion,
            json.dumps({"modelId": "m" * 20000, "inputTokens": 7}),
        ),
        "evt_empty": (completion, "{}"),
        "evt_null": (completion, None),
        "evt_not_json": (completion, "{not json"),
        "evt_list": (completion, "[1, 2]"),
        "evt_embed": (
            "Embedding Usage",
            json.dumps({"promptTokens": 5000, "source": "index-scan"}),
        ),
        "evt_embed_odd": ("Embedding Usage", json.dumps({"promptTokens": "12"})),
        "evt_other": ("Task Message", json.dumps({"modelId": "m", "inputTokens": 5})),
    }
    filler = 5000
    with sqlite3.connect(db_file) as conn:
        conn.execute(
            "INSERT INTO users (id, authentik_id, email) VALUES ('user_1', 'ak_1', 'a@b.c')"
        )
        conn.executemany(
            "INSERT INTO telemetry_events (id, user_id, event_type, properties) "
            "VALUES (?, 'user_1', ?, ?)",
            [(row_id, kind, payload) for row_id, (kind, payload) in events.items()]
            + [
                (f"evt_z{n:05}", completion, '{"inputTokens": 1}')
                for n in range(filler)
            ],
        )

    _alembic(run, "upgrade", "head")

    lifted = sorted(
        set(event_columns(completion, {})) | set(event_columns("Embedding Usage", {}))
    )
    with sqlite3.connect(db_file) as conn:
        conn.row_factory = sqlite3.Row
        stored = {
            row["id"]: {name: row[name] for name in lifted}
            for row in conn.execute(
                f"SELECT id, {', '.join(lifted)} FROM telemetry_events"
            )
        }
    for row_id, (kind, payload) in events.items():
        # An oversized payload, which no real client sends, reads as empty.
        props = {} if row_id == "evt_oversized" else parse_event_props(payload)
        expected = dict.fromkeys(lifted) | event_columns(kind, props or {})
        assert stored[row_id] == expected, row_id
    assert stored["evt_hostile"]["model_id"] == "evilmodel"
    assert sum(1 for row in stored.values() if row["input_tokens"] == 1) == filler


def test_seen_folders_are_bound_by_the_rules_of_a_recorded_folder(migrate_env):
    """c1d2e3f4a5b6 binds every folder of tasks and recordings: the remote its
    tasks' telemetry named last (two folders of one repository are one
    project), else a parent task's project in the same tenant, else a folder
    project; a folder bound already keeps its project, and the tasks follow."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "b0c1d2e3f4a5")

    repo = "https://github.com/QUB-IT/Roo-Code.git"
    events = [
        ("t_main", "2026-10-01", {"repositoryUrl": "https://github.com/x/old"}),
        ("t_main_old", "2026-10-02", {"repositoryUrl": "https://github.com/x/old"}),
        ("t_main", "2026-10-03", {"repositoryUrl": repo}),
        ("t_clone", "2026-10-01", {"repositoryUrl": repo}),
    ]
    with sqlite3.connect(db_file) as conn:
        conn.execute(
            "INSERT INTO users (id, authentik_id, email) VALUES ('u1', 'ak_1', 'a@b.c')"
        )
        conn.execute("INSERT INTO organizations (id, name) VALUES ('org1', 'Acme')")
        conn.executemany(
            "INSERT INTO tasks (id, user_id, organization_id, workspace_path) VALUES (?, 'u1', ?, ?)",
            [
                ("t_main", None, "/w/Roo-Code"),
                ("t_main_old", None, "/w/Roo-Code"),
                ("t_wt", None, "/w/.roo/worktrees/Roo-Code-1"),
                ("t_wt_org", "org1", "/w/.roo/worktrees/Roo-Code-2"),
                ("t_notes", None, "/w/notes"),
                ("t_bound", None, "/w/bound"),
            ],
        )
        # The clone only recorded exchanges, it has no task row.
        conn.execute(
            "INSERT INTO llm_exchanges (id, user_id, task_id, workspace_path, sequence, occurred_at, created_at, status, issues, payload) "
            "VALUES ('ex1', 'u1', 't_clone', '/w/clone', 0, '2026-10-01', '2026-10-01', 'completed', '', '{}')"
        )
        conn.executemany(
            "INSERT INTO telemetry_events (id, user_id, event_type, task_id, properties, created_at) "
            "VALUES (?, 'u1', 'Task Message', ?, ?, ?)",
            [
                (f"evt{n}", task_id, json.dumps({"taskId": task_id, **props}), at)
                for n, (task_id, at, props) in enumerate(events)
            ],
        )
        conn.executemany(
            "INSERT INTO task_relations (child_task_id, parent_task_id) VALUES (?, 't_main')",
            [("t_wt",), ("t_wt_org",)],
        )
        conn.execute(
            "INSERT INTO projects (id, tenant_id, user_id, key, name) "
            "VALUES ('prj_kept', 'u1', 'u1', 'folder:kept', 'kept')"
        )
        conn.execute(
            "INSERT INTO project_bindings (id, user_id, tenant_id, workspace_path, project_id) "
            "VALUES ('pb_kept', 'u1', 'u1', '/w/bound', 'prj_kept')"
        )

    _alembic(run, "upgrade", "head")

    with sqlite3.connect(db_file) as conn:
        projects = dict(conn.execute("SELECT id, key FROM projects").fetchall())
        folders = {
            (tenant, path): projects[project_id]
            for tenant, path, project_id in conn.execute(
                "SELECT tenant_id, workspace_path, project_id FROM project_bindings"
            )
        }
        tasks = dict(conn.execute("SELECT id, project_id FROM tasks").fetchall())
    assert folders == {
        ("u1", "/w/Roo-Code"): "github.com/qub-it/roo-code",
        ("u1", "/w/clone"): "github.com/qub-it/roo-code",
        ("u1", "/w/.roo/worktrees/Roo-Code-1"): "github.com/qub-it/roo-code",
        ("org1", "/w/.roo/worktrees/Roo-Code-2"): folder_key(
            "u1", "/w/.roo/worktrees/Roo-Code-2"
        ),
        ("u1", "/w/notes"): folder_key("u1", "/w/notes"),
        ("u1", "/w/bound"): "folder:kept",
    }
    assert len(projects) == 4
    assert {projects[project_id] for project_id in tasks.values()} == {
        "github.com/qub-it/roo-code",
        folder_key("u1", "/w/.roo/worktrees/Roo-Code-2"),
        folder_key("u1", "/w/notes"),
        "folder:kept",
    }
    assert tasks["t_wt"] == tasks["t_main"]


def test_duplicate_project_names_are_renamed_like_new_ones(migrate_env):
    """d3e4f5a6b7c8: the oldest project of a name (case-insensitively, per
    tenant) keeps it; the others take the first free name_candidates and
    remember the old one; then the tenant's names are unique."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "c2d3e4f5a6b7")

    with sqlite3.connect(db_file) as conn:
        conn.executemany(
            "INSERT INTO users (id, authentik_id, email) VALUES (?, ?, ?)",
            [("u1", "ak_1", "alice@x.org"), ("u2", "ak_2", "bob@x.org")],
        )
        conn.execute("INSERT INTO organizations (id, name) VALUES ('org1', 'Acme')")
        conn.executemany(
            "INSERT INTO projects (id, tenant_id, user_id, key, name, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("p1", "org1", "u1", "folder:1", "notes", "2026-10-01"),
                ("p2", "org1", "u2", "folder:2", "Notes", "2026-10-02"),
                ("p3", "org1", "u2", "folder:3", "notes (bob)", "2026-10-03"),
                ("p4", "org1", "u2", "folder:4", "notes", "2026-10-04"),
                ("p5", "org1", "u1", "github.com/acme/api", "api", "2026-10-01"),
                ("p6", "org1", "u1", "gitlab.com/ops/api", "api", "2026-10-01"),
                ("p7", "u2", "u2", "folder:7", "notes", "2026-10-01"),
            ],
        )

    _alembic(run, "upgrade", "head")

    with sqlite3.connect(db_file) as conn:
        names = {
            row[0]: row[1:]
            for row in conn.execute("SELECT id, name, wanted_name FROM projects")
        }
        assert names == {
            "p1": ("notes", None),
            "p2": ("Notes (bob, 2)", "Notes"),
            "p3": ("notes (bob)", None),
            "p4": ("notes (bob, 3)", "notes"),
            "p5": ("api", None),
            "p6": ("api (ops)", "api"),
            "p7": ("notes", None),
        }
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO projects (id, tenant_id, user_id, key, name) "
                "VALUES ('p8', 'org1', 'u1', 'folder:8', 'API')"
            )


def test_a_fresh_database_downgrades_through_the_chain(migrate_env):
    """Every downgrade finds what it drops on a create_all database too: the
    model names each object the way its migration does (a7b8c9d0e1f2 drops
    fk_tasks_parent_task_id by name)."""
    db_file, run = migrate_env
    assert run("sh", "./db-migrate.sh").returncode == 0

    _alembic(run, "downgrade", SQLITE_START_REVISION)

    assert _alembic_version(db_file) == SQLITE_START_REVISION
    assert "task_relations" not in _tables(db_file)


def test_run_totals_backfill_sums_each_run_and_names_its_primary_model(migrate_env):
    """f0a1b2c3d4e5 stores each task's run totals: the task and every task
    beneath it of the same owner, at most RUN_DEPTH_MAX levels down (the walk
    stops at another owner's task, and a cycle counts each member once), and
    the first name of its models label. Message figures a client stored past
    the bounds of one request count as 0 and their tasks are summed again:
    two of 9e18 tokens in one run overflowed the sum and stopped the upgrade.
    A link to a parent id too long for ix_tasks_parent_user is cut."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "d4e5f6a7b8c1")

    # id, owner, parent, cost, tokens in, tokens out, duration ms, models
    tasks = [
        ("root", "u1", None, 1.0, 10, 1, 100, "glm-5.3, opus"),
        ("child", "u1", "root", 2.0, 20, 2, 200, "opus,glm-5.3"),
        ("grandchild", "u1", "child", 4.0, 40, 4, 400, None),
        ("foreign", "u2", "root", 8.0, 80, 8, 800, None),
        ("below_foreign", "u1", "foreign", 16.0, 160, 16, 1600, None),
        ("loop_a", "u1", "loop_b", 32.0, 0, 0, 0, None),
        ("loop_b", "u1", "loop_a", 64.0, 0, 0, 0, None),
        # Stored by the base code from messages of 9e18 tokens and a cost of
        # 1e300 (task_messages below).
        ("evil_root", "u1", None, 1e300, 9 * 10**18, 0, 0, None),
        ("evil_sub", "u1", "evil_root", 0.5, 9 * 10**18, 7, 0, None),
        ("x" * 257, "u1", None, 2.0, 0, 0, 0, None),
        ("below_long", "u1", "x" * 257, 3.0, 0, 0, 0, None),
    ]
    # A chain one level deeper than a run reaches: its root counts every
    # task but the last.
    depth = 128
    chain = [
        (f"deep{n:03}", "u1", f"deep{n - 1:03}" if n else None, 1.0, 0, 0, 0, None)
        for n in range(depth + 2)
    ]
    messages = [
        ("m1", "evil_root", 1, 9 * 10**18, 0, 1e300),
        ("m2", "evil_sub", 1, 9 * 10**18, 7, 0.5),
    ]
    with sqlite3.connect(db_file) as conn:
        conn.executemany(
            "INSERT INTO users (id, authentik_id, email) VALUES (?, ?, ?)",
            [("u1", "ak_1", "a@b.c"), ("u2", "ak_2", "d@e.f")],
        )
        conn.executemany(
            "INSERT INTO tasks (id, user_id, parent_task_id, cost, tokens_in, "
            "tokens_out, duration_ms, models) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            tasks + chain,
        )
        conn.executemany(
            "INSERT INTO task_messages (id, task_id, message_data, message_ts, "
            "tokens_in, tokens_out, cost) VALUES (?, ?, '{}', ?, ?, ?, ?)",
            messages,
        )
        conn.executemany(
            "INSERT INTO task_relations (child_task_id, parent_task_id, user_id) "
            "VALUES (?, ?, 'u1')",
            [("below_long", "x" * 257), ("child", "root")],
        )

    _alembic(run, "upgrade", "head")

    with sqlite3.connect(db_file) as conn:
        stored = {
            row[0]: row[1:]
            for row in conn.execute(
                "SELECT id, run_cost, run_tokens, run_duration_ms, primary_model "
                "FROM tasks"
            )
        }
        own = conn.execute(
            "SELECT tokens_in, tokens_out, cost FROM tasks WHERE id = 'evil_sub'"
        ).fetchone()
        relations = conn.execute("SELECT child_task_id FROM task_relations").fetchall()
    assert own == (0, 7, 0.5)
    assert relations == [("child",)]
    assert stored.pop("deep000")[0] == depth + 1
    assert stored.pop(f"deep{depth + 1:03}")[0] == 1
    stored = {k: v for k, v in stored.items() if not k.startswith("deep")}
    assert stored == {
        "root": (7.0, 77, 700, "glm-5.3"),
        "child": (6.0, 66, 600, "opus"),
        "grandchild": (4.0, 44, 400, None),
        "foreign": (8.0, 88, 800, None),
        "below_foreign": (16.0, 176, 1600, None),
        "loop_a": (96.0, 0, 0, None),
        "loop_b": (96.0, 0, 0, None),
        "evil_root": (0.5, 7, 0, None),
        "evil_sub": (0.5, 7, 0, None),
        "x" * 257: (2.0, 0, 0, None),
        "below_long": (3.0, 0, 0, None),
    }


def test_list_indexes_rebuild_labels_too_long_for_the_models_index(migrate_env):
    """f1a2b3c4d5e6 indexes (user_id, models), and Postgres refuses an entry
    over 2704 bytes. The base code stored a label of any length: a longer
    one is rebuilt from its cleaned names, most-used first, while they fit
    LABEL_MAX_BYTES, with its primary model; the rest stay as they are."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "f0a1b2c3d4e5")

    many = [f"model-{n:03}-" + "x" * 14 for n in range(150)]
    labels = {
        "normal": "glm-5.3, opus",
        "long_id": "\tA" + "b" * 3000 + ", opus",
        "many": ", ".join(many),
    }
    with sqlite3.connect(db_file) as conn:
        conn.execute(
            "INSERT INTO users (id, authentik_id, email) VALUES ('u1', 'ak_1', 'a@b.c')"
        )
        conn.executemany(
            "INSERT INTO tasks (id, user_id, models, primary_model) "
            "VALUES (?, 'u1', ?, 'stale')",
            list(labels.items()),
        )

    _alembic(run, "upgrade", "head")

    with sqlite3.connect(db_file) as conn:
        stored = dict(
            (row[0], row[1:])
            for row in conn.execute("SELECT id, models, primary_model FROM tasks")
        )
    assert stored["normal"] == ("glm-5.3, opus", "stale")
    assert stored["long_id"] == ("A" + "b" * 255 + ", opus", "A" + "b" * 255)
    label, primary = stored["many"]
    assert len(label.encode()) <= LABEL_MAX_BYTES < len(labels["many"].encode())
    assert label == ", ".join(many[: label.count(",") + 1])
    assert primary == many[0]
