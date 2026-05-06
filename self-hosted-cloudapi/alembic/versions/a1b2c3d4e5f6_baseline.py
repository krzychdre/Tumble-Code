"""Baseline schema – matches existing database before timezone fix.

Revision ID: a1b2c3d4e5f6
Revises: None
Create Date: 2026-05-06 09:30:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This revision represents the schema as it currently exists in the
    # database (DateTime columns WITHOUT timezone).  If the database was
    # created by create_all, stamp this revision and skip:
    #   alembic stamp a1b2c3d4e5f6
    # For a fresh database, running upgrade will create all tables.
    pass


def downgrade() -> None:
    pass
