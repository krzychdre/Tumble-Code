"""Record which client sent each record: the VS Code extension or the CLI.

The CLI can sign in to this cloud and then sends the same telemetry, error
reports and LLM exchanges as the extension. The pages tell the two apart by a
``client_kind`` column ("vscode" or "cli") on:

  * telemetry_events, error_reports, llm_exchanges: stamped at ingest from the
    record's ``clientKind`` or, for older clients, its ``editorName``
    (services/client_kind.client_kind_from);
  * tasks: "cli" once any telemetry event of the task came from the CLI.

NOT NULL with the server default "vscode": every record stored before this
came from VS Code, unless the backfill below finds the CLI's editor name
(``wrapper|cli|...``) or an explicit ``clientKind`` in it. No index: every
reader narrows by user and time first, and a two-value column only filters
the rows those indexes already found.

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-10-03 11:30:00.000000

"""

import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None

TABLES = ("telemetry_events", "error_reports", "llm_exchanges", "tasks")
# The JSON column each record keeps its camelCase fields in.
SOURCES = (
    ("telemetry_events", "properties"),
    ("error_reports", "payload"),
    ("llm_exchanges", "payload"),
)
BATCH = 5000


def _is_cli(fields) -> bool:
    """services/client_kind.client_kind_from, frozen as it was when this ran."""
    if not isinstance(fields, dict):
        return False
    kind = fields.get("clientKind")
    if isinstance(kind, str) and kind.strip().lower() in ("vscode", "cli"):
        return kind.strip().lower() == "cli"
    editor = fields.get("editorName")
    return isinstance(editor, str) and editor.startswith("wrapper|cli")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table, sa.Column("client_kind", sa.String(), nullable=False, server_default="vscode")
        )

    _backfill()


def _backfill() -> None:
    """Mark the CLI's records among the stored ones, then the CLI's tasks.

    Only a payload that mentions "cli" at all can be one, so the database
    drops every other row before Python parses any JSON; the rest is walked
    in batches by id (keyset, not OFFSET: the walk updates the table it reads)
    so a corpus of any size stays within a sane amount of memory.
    """
    conn = op.get_bind()

    for table, column in SOURCES:
        last_id = ""
        while True:
            rows = conn.execute(
                sa.text(
                    f"SELECT id, {column} FROM {table} "
                    f"WHERE id > :last AND {column} LIKE '%cli%' "
                    "ORDER BY id LIMIT :limit"
                ),
                {"last": last_id, "limit": BATCH},
            ).fetchall()
            if not rows:
                break
            last_id = rows[-1][0]

            cli_ids = []
            for row_id, payload in rows:
                try:
                    fields = json.loads(payload or "{}")
                except (json.JSONDecodeError, TypeError):
                    continue
                if _is_cli(fields):
                    cli_ids.append({"row_id": row_id})
            if cli_ids:
                conn.execute(
                    sa.text(f"UPDATE {table} SET client_kind = 'cli' WHERE id = :row_id"),
                    cli_ids,
                )

    # A task is the CLI's when its own user's telemetry for it is, the rule
    # telemetry_service.stamp_task_client applies from now on.
    conn.execute(
        sa.text(
            "UPDATE tasks SET client_kind = 'cli' WHERE EXISTS ("
            "SELECT 1 FROM telemetry_events e WHERE e.task_id = tasks.id "
            "AND e.user_id = tasks.user_id AND e.client_kind = 'cli')"
        )
    )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_column(table, "client_kind")
