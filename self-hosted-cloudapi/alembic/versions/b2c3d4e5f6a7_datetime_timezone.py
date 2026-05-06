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


def upgrade() -> None:
    # authentik_state_store
    op.alter_column(
        "authentik_state_store", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )
    op.alter_column(
        "authentik_state_store", "expires_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # users (TimestampMixin)
    op.alter_column(
        "users", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "users", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # sessions
    op.alter_column(
        "sessions", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )
    op.alter_column(
        "sessions", "expires_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )

    # client_tokens
    op.alter_column(
        "client_tokens", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )
    op.alter_column(
        "client_tokens", "expires_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )

    # tickets
    op.alter_column(
        "tickets", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )
    op.alter_column(
        "tickets", "expires_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # organizations (TimestampMixin)
    op.alter_column(
        "organizations", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "organizations", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # memberships (TimestampMixin)
    op.alter_column(
        "memberships", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "memberships", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # organization_settings (TimestampMixin)
    op.alter_column(
        "organization_settings", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "organization_settings", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # user_settings (TimestampMixin)
    op.alter_column(
        "user_settings", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "user_settings", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # provider_configs (TimestampMixin)
    op.alter_column(
        "provider_configs", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "provider_configs", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # tasks (TimestampMixin)
    op.alter_column(
        "tasks", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )
    op.alter_column(
        "tasks", "updated_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=False,
    )

    # task_messages
    op.alter_column(
        "task_messages", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )

    # task_shares
    op.alter_column(
        "task_shares", "expires_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )
    op.alter_column(
        "task_shares", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )

    # telemetry_events
    op.alter_column(
        "telemetry_events", "created_at",
        type_=sa.DateTime(timezone=True), existing_type=sa.DateTime(),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Reverse all changes: TIMESTAMPTZ -> TIMESTAMP
    tables_columns = [
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

    for table, column, nullable in reversed(tables_columns):
        op.alter_column(
            table, column,
            type_=sa.DateTime(), existing_type=sa.DateTime(timezone=True),
            existing_nullable=nullable,
        )