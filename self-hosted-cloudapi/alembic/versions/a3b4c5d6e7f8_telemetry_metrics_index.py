"""Index telemetry_events for the metrics page.

The metrics page reads one user's ``LLM Completion`` (and ``Embedding Usage``)
events over a ``created_at`` range, ordered by ``created_at``
(services/metrics_service). The table only had single-column indexes, so
Postgres answered it with a bitmap scan on ``event_type``, filtered the other
users and the rest of the period row by row, and sorted the result. One
composite index on ``(user_id, event_type, created_at)`` serves the equality
filters, the range and the ORDER BY.

A plain ``CREATE INDEX`` (not ``CONCURRENTLY``): it blocks writes to
``telemetry_events`` while it builds, which on the live table (about 20k rows,
36 MB) takes well under a second, and ``CONCURRENTLY`` cannot run inside the
transaction alembic wraps each migration in.

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-26 09:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "a3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None

_INDEX = "ix_telemetry_events_user_type_created"


def upgrade() -> None:
    op.create_index(_INDEX, "telemetry_events", ["user_id", "event_type", "created_at"])


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="telemetry_events")
