"""One membership per (user, organization).

Every reader assumes it (``membership_of`` uses ``db.scalar``), but nothing
enforced it: two organization syncs in different processes could insert the
same pair. Keeps the oldest row of each pair (the sync rewrites its role on
the next tick), then adds the unique index. create_all builds the same schema
on a FRESH database (src/db_bootstrap.py).

Revision ID: a1c2e3f4b5d6
Revises: f3c4d5e6a7b8
Create Date: 2026-11-06 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "a1c2e3f4b5d6"
down_revision = "f3c4d5e6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM memberships
            WHERE EXISTS (
                SELECT 1 FROM memberships older
                WHERE older.user_id = memberships.user_id
                  AND older.organization_id = memberships.organization_id
                  AND (older.created_at < memberships.created_at
                       OR (older.created_at = memberships.created_at
                           AND older.id < memberships.id))
            )
            """
        )
    )
    op.create_index(
        "uq_memberships_user_org",
        "memberships",
        ["user_id", "organization_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_memberships_user_org", table_name="memberships")
