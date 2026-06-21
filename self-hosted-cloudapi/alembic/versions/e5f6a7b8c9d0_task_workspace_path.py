"""Add tasks.workspace_path for project/worktree attribution.

The cloud web view could not show which project/worktree a task belonged to.
The extension already captures the workspace folder root (the bridge's
extension:register `workspacePath`, and the share/backfill payload), but the
server never persisted it. This adds a nullable column to hold it; null for
legacy rows and tasks created with no known workspace (bridge offline and no
explicit client field).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-21 13:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("workspace_path", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tasks", "workspace_path")
