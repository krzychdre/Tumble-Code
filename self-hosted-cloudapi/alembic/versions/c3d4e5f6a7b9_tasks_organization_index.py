"""Index tasks.organization_id.

The metrics page's organization space reads every completion of an
organization's tasks: the organization's tasks first (this index), then their
events (ix_telemetry_events_task_id). create_all builds the same index on a
FRESH database (models/task).

Revision ID: c3d4e5f6a7b9
Revises: d3e4f5a6b7c8
Create Date: 2026-10-27 10:30:00.000000

"""

from alembic import op

revision = "c3d4e5f6a7b9"
down_revision = "d3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_tasks_organization_id", "tasks", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_organization_id", table_name="tasks")
