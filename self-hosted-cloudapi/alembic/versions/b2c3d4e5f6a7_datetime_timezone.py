"""Add timezone=True to all DateTime columns.

PostgreSQL asyncpg driver refuses to mix offset-naive and offset-aware
datetimes.  All Python code uses datetime.now(timezone.utc), but the
database columns were TIMESTAMP WITHOUT TIME ZONE.  This migration
converts them to TIMESTAMP WITH TIME ZONE.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-06 09:35:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


# (table, column, nullable) of every DateTime column at the baseline.
_COLUMNS = [
    ("authentik_state_store", "created_at", True),
    ("authentik_state_store", "expires_at", False),
    ("users", "created_at", False),
    ("users", "updated_at", False),
    ("sessions", "created_at", True),
    ("sessions", "expires_at", True),
    ("client_tokens", "created_at", True),
    ("client_tokens", "expires_at", True),
    ("tickets", "created_at", True),
    ("tickets", "expires_at", False),
    ("organizations", "created_at", False),
    ("organizations", "updated_at", False),
    ("memberships", "created_at", False),
    ("memberships", "updated_at", False),
    ("organization_settings", "created_at", False),
    ("organization_settings", "updated_at", False),
    ("user_settings", "created_at", False),
    ("user_settings", "updated_at", False),
    ("provider_configs", "created_at", False),
    ("provider_configs", "updated_at", False),
    ("tasks", "created_at", False),
    ("tasks", "updated_at", False),
    ("task_messages", "created_at", True),
    ("task_shares", "expires_at", True),
    ("task_shares", "created_at", True),
    ("telemetry_events", "created_at", True),
]


def _alter_all(new_type, old_type, order) -> None:
    # A database built by create_all after the provider_configs model was
    # retired (src/models RETIRED_TABLES) has no such table.
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table, column, nullable in order(_COLUMNS):
        if table in tables:
            op.alter_column(
                table, column, type_=new_type, existing_type=old_type, existing_nullable=nullable
            )


def upgrade() -> None:
    _alter_all(sa.DateTime(timezone=True), sa.DateTime(), list)


def downgrade() -> None:
    _alter_all(sa.DateTime(), sa.DateTime(timezone=True), reversed)
