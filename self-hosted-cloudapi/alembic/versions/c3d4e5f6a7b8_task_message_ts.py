"""Add task_messages.message_ts for live-bridge upserts.

The live remote-control bridge streams a single ClineMessage through several
states (created → partial updates → final). To avoid appending duplicate rows
for the same logical message, the relay upserts by the message's `ts`. This adds
a nullable, indexed BigInteger column to hold it (null for legacy/backfilled
rows, which continue to be appended as before).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-20 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_messages",
        sa.Column("message_ts", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_task_messages_message_ts", "task_messages", ["message_ts"]
    )


def downgrade() -> None:
    op.drop_index("ix_task_messages_message_ts", table_name="task_messages")
    op.drop_column("task_messages", "message_ts")
