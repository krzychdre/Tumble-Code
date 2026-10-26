"""Session cards, the rebuild queue and the recall log; tasks.recall_excluded.

Cross-session recall, phase "cards and search"; see
ai_plans/2026-10-26_18-22_cross-session-recall.md. create_all builds the same
schema on a FRESH database (src/db_bootstrap.py, models/recall). Cards start
empty: every project starts with recall off, and switching it on queues the
project's tasks.

Revision ID: c2d3e4f5a6b7
Revises: c1d2e3f4a5b6
Create Date: 2026-10-27 00:30:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c2d3e4f5a6b7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    postgres = op.get_bind().dialect.name == "postgresql"
    if postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS btree_gin")
    op.create_table(
        "session_cards",
        sa.Column(
            "task_id",
            sa.String(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column(
            "project_id",
            sa.String(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR() if postgres else sa.Text(),
            nullable=False,
        ),
        sa.Column("last_ts", sa.BigInteger(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_session_cards_search",
        "session_cards",
        ["project_id", "search_vector"],
        postgresql_using="gin",
    )
    op.create_index(
        "ix_session_cards_recent", "session_cards", ["tenant_id", "last_ts"]
    )
    op.create_index(
        "ix_session_cards_project_recent", "session_cards", ["project_id", "last_ts"]
    )

    op.create_table(
        "recall_dirty",
        sa.Column("task_id", sa.String(), primary_key=True),
        sa.Column("dirty_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_recall_dirty_dirty_at", "recall_dirty", ["dirty_at"])

    op.create_table(
        "recall_log",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("query", sa.String(), nullable=True),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.Column("took_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_recall_log_user_id", "recall_log", ["user_id"])

    op.add_column(
        "tasks",
        sa.Column("recall_excluded", sa.Boolean(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("recall_excluded")
    op.drop_index("ix_recall_log_user_id", table_name="recall_log")
    op.drop_table("recall_log")
    op.drop_index("ix_recall_dirty_dirty_at", table_name="recall_dirty")
    op.drop_table("recall_dirty")
    op.drop_index("ix_session_cards_project_recent", table_name="session_cards")
    op.drop_index("ix_session_cards_recent", table_name="session_cards")
    op.drop_index("ix_session_cards_search", table_name="session_cards")
    op.drop_table("session_cards")
