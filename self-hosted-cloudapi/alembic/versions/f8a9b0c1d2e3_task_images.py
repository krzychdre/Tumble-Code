"""Images a task's messages point to by path.

The clients upload the image files a conversation references by workspace
path (``![chart](monitoring/x.png)``), so the web panel can show them; see
ai_plans/2026-10-12_18-00_cloud-web-task-images.md. create_all builds the same
table on a FRESH database (src/db_bootstrap.py).

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-10-12 18:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_images",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "task_id",
            sa.String(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("message_ts", sa.BigInteger(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "uq_task_images_task_ts_path",
        "task_images",
        ["task_id", "message_ts", "path"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_task_images_task_ts_path", table_name="task_images")
    op.drop_table("task_images")
