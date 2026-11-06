"""Store a telemetry event once when the client sends it again.

The client's retry queue re-sends an event after a timeout or a 5xx, also
when the first request was committed, so an LLM Completion could be stored
and counted in usage_rollup twice. The client now stamps each event with an
id kept across retries; ``(user_id, client_event_id)`` is unique and the
insert skips a repeat. Rows from before, and events from older clients, have
no id (NULL never conflicts). create_all builds the same schema on a FRESH
database (src/db_bootstrap.py).

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-11-06 19:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "c6d7e8f9a0b1"
down_revision = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "telemetry_events", sa.Column("client_event_id", sa.String(), nullable=True)
    )
    op.create_index(
        "uq_telemetry_events_user_client_event",
        "telemetry_events",
        ["user_id", "client_event_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_telemetry_events_user_client_event", table_name="telemetry_events"
    )
    with op.batch_alter_table("telemetry_events") as batch:
        batch.drop_column("client_event_id")
