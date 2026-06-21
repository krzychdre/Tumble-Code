"""Deduplicate task_messages and enforce a unique (task_id, message_ts).

The live bridge relays a single ClineMessage through many states
(created → partial updates → final). The relay upserts by `ts`, but with only a
plain index and a non-atomic SELECT-then-write, rapid partial events (notably
streaming `reasoning`) raced and inserted duplicate `partial:true` rows. Once
duplicates existed, the finalizing `partial:false` update hit
`scalar_one_or_none()` → `MultipleResultsFound`, which the relay swallowed, so
the rows stayed `partial:true` forever (stuck spinners / phantom "Thinking…").

This dedups existing rows and adds a real unique index so the upsert can use a
race-proof `ON CONFLICT … DO UPDATE`.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-21 12:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Collapse pre-existing duplicates, keeping the most complete copy (longest
    # message_data == the finalized/fullest partial), tie-broken by id. Only
    # Postgres can have accumulated dupes in practice; SQLite test DBs start
    # clean, and DELETE…USING is Postgres-specific.
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            DELETE FROM task_messages t
            USING (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY task_id, message_ts
                           ORDER BY LENGTH(message_data) DESC, id DESC
                       ) AS rn
                FROM task_messages
                WHERE message_ts IS NOT NULL
            ) d
            WHERE t.id = d.id AND d.rn > 1
            """
        )

    # NULL message_ts stays distinct (legacy/backfilled rows still append).
    op.create_index(
        "uq_task_messages_task_ts",
        "task_messages",
        ["task_id", "message_ts"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_task_messages_task_ts", table_name="task_messages")
