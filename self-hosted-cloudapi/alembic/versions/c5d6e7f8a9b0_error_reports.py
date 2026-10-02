"""Error reports: one row per problem the extension reports, with its evidence.

The diagnostics page could only count error telemetry, and the telemetry the
live deployment holds says almost nothing (1743 code-index errors without a
message, 0 exceptions). The extension now sends a report per problem while
the user is signed in (POST /api/error-reports): category, model, provider,
context size, the tail of the request and the response. This adds the table;
create_all builds the same table on a FRESH database (src/db_bootstrap.py).

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-10-02 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "error_reports",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.String(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("model_id", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), nullable=True),
        sa.Column("app_version", sa.String(), nullable=True),
        sa.Column("tool_name", sa.String(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("signature", sa.String(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
    )
    op.create_index("ix_error_reports_user_id", "error_reports", ["user_id"])
    op.create_index("ix_error_reports_organization_id", "error_reports", ["organization_id"])
    op.create_index("ix_error_reports_task_id", "error_reports", ["task_id"])
    op.create_index("ix_error_reports_category", "error_reports", ["category"])
    op.create_index("ix_error_reports_model_id", "error_reports", ["model_id"])
    op.create_index("ix_error_reports_signature", "error_reports", ["signature"])
    op.create_index("ix_error_reports_created_at", "error_reports", ["created_at"])
    op.create_index("ix_error_reports_user_created", "error_reports", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_table("error_reports")
