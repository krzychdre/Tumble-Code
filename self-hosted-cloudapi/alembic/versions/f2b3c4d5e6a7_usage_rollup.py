"""Sum the figures of LLM Completion and Embedding Usage events per task and quarter of an hour.

The metrics and diagnostics pages summed every event of their period: an
organization's all-time page read millions of them. usage_rollup holds the
same figures per user, quarter of an hour of UTC, task and combination of
names (models/event.UsageRollup), and ingest adds each new event into its row
(services/telemetry_service.add_to_rollup). This creates the table and builds
the rows of the events stored before, from the columns e8f9a0b1c2d3 lifted
out of them.

A row's key is the sha256 of its task, names and client, computed in Python
(no hash function exists on both databases), so the events are grouped in
SQL and the groups stream through Python in batches. Left out: events of a
deleted user (user_id NULL), which no page reads, and events without a
created_at, which belong to no quarter.

Revision ID: f2b3c4d5e6a7
Revises: f1b2c3d4e5a6
Create Date: 2026-10-28 10:00:00.000000

"""

import hashlib
import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f2b3c4d5e6a7"
down_revision = "f1b2c3d4e5a6"
branch_labels = None
depends_on = None

LLM_COMPLETION_EVENT = "LLM Completion"
EMBEDDING_EVENT = "Embedding Usage"
QUARTER_SECONDS = 900
BATCH = 5000

NAMES = (
    "task_id",
    "model_id",
    "provider",
    "mode",
    "completion_kind",
    "embedding_source",
    "client_kind",
)
WHOLE_SUMS = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "duration_ms",
)

events = sa.table(
    "telemetry_events",
    sa.column("user_id", sa.String),
    sa.column("event_type", sa.String),
    sa.column("usage_reported", sa.Boolean),
    sa.column("cost", sa.Float),
    sa.column("created_at", sa.DateTime(timezone=True)),
    *(sa.column(name, sa.String) for name in NAMES),
    *(sa.column(name, sa.BigInteger) for name in WHOLE_SUMS),
)


def _key(row) -> str:
    """services/telemetry_service.rollup_key as it was when this ran."""
    names = [getattr(row, name) for name in NAMES]
    return hashlib.sha256(json.dumps(names).encode()).hexdigest()


def upgrade() -> None:
    rollup = op.create_table(
        "usage_rollup",
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("quarter", sa.BigInteger(), nullable=False),
        sa.Column("names_key", sa.String(64), nullable=False),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("client_kind", sa.String(), nullable=False),
        sa.Column("model_id", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), nullable=True),
        sa.Column("completion_kind", sa.String(), nullable=True),
        sa.Column("embedding_source", sa.String(), nullable=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False),
        sa.Column("cache_read_tokens", sa.BigInteger(), nullable=False),
        sa.Column("cache_write_tokens", sa.BigInteger(), nullable=False),
        sa.Column("cost", sa.Float(), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False),
        sa.Column("events", sa.BigInteger(), nullable=False),
        sa.Column("unreported", sa.BigInteger(), nullable=False),
        sa.Column("first_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "event_type", "quarter", "names_key"),
    )

    quarter = (
        sa.cast(sa.func.floor(sa.extract("epoch", events.c.created_at)), sa.BigInteger)
        // QUARTER_SECONDS
    )
    groups = (
        sa.select(
            events.c.user_id,
            events.c.event_type,
            quarter.label("quarter"),
            *(events.c[name] for name in NAMES),
            *(
                sa.cast(
                    sa.func.coalesce(sa.func.sum(events.c[name]), 0), sa.BigInteger
                ).label(name)
                for name in WHOLE_SUMS
            ),
            sa.func.coalesce(sa.func.sum(events.c.cost), 0.0).label("cost"),
            sa.func.count().label("events"),
            sa.func.count()
            .filter(events.c.usage_reported.is_(False))
            .label("unreported"),
            sa.func.min(events.c.created_at).label("first_at"),
        )
        .where(
            events.c.event_type.in_([LLM_COMPLETION_EVENT, EMBEDDING_EVENT]),
            events.c.user_id.is_not(None),
            events.c.created_at.is_not(None),
        )
        .group_by(
            events.c.user_id,
            events.c.event_type,
            quarter,
            *(events.c[name] for name in NAMES),
        )
    )
    conn = op.get_bind()
    for rows in conn.execute(groups.execution_options(yield_per=BATCH)).partitions():
        conn.execute(
            rollup.insert(),
            [{**row._mapping, "names_key": _key(row)} for row in rows],
        )


def downgrade() -> None:
    op.drop_table("usage_rollup")
