"""Task duration as the sum of its model requests.

``task_messages.duration_ms`` holds what one ``api_req_started`` or
``condense_context`` message measured (its ``durationMs``), ``tasks.duration_ms``
their sum. Messages stored before clients measured requests carry no
``durationMs``, so both start at 0 and nothing is backfilled.

Revision ID: d4e5f6a7b8c1
Revises: c3d4e5f6a7b9
Create Date: 2026-10-27 19:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c1"
down_revision = "c3d4e5f6a7b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("task_messages", "tasks"):
        op.add_column(
            table,
            sa.Column(
                "duration_ms", sa.BigInteger(), nullable=False, server_default="0"
            ),
        )


def downgrade() -> None:
    for table in ("task_messages", "tasks"):
        op.drop_column(table, "duration_ms")
