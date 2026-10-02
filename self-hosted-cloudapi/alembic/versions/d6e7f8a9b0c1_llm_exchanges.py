"""LLM exchanges, their blobs and the dataset switch.

The extension records every request it sends to the model and the answer
(POST /api/llm-exchanges), incrementally: an exchange is a delta of an earlier
one of its task, and the large texts it shares with them live in llm_blobs.
The dataset page exports them as a clean, anonymized training dataset and can
reconstruct every request exactly. create_all builds the same tables on a
FRESH database (src/db_bootstrap.py).

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-10-02 18:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_exchanges",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "organization_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("base_id", sa.String(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("model_id", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), nullable=True),
        sa.Column("workspace_path", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("finish_reason", sa.String(), nullable=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("tool_call_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_wire", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("issues", sa.String(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=True),
    )
    op.create_index("ix_llm_exchanges_user_id", "llm_exchanges", ["user_id"])
    op.create_index("ix_llm_exchanges_created_at", "llm_exchanges", ["created_at"])
    op.create_index("ix_llm_exchanges_model_id", "llm_exchanges", ["model_id"])
    op.create_index("ix_llm_exchanges_user_created", "llm_exchanges", ["user_id", "created_at"])
    op.create_index("ix_llm_exchanges_user_task", "llm_exchanges", ["user_id", "task_id"])

    op.create_table(
        "llm_blobs",
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("task_id", sa.String(), primary_key=True),
        sa.Column("sha256", sa.String(), primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "dataset_settings",
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("recording_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("anonymize_terms", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("dataset_settings")
    op.drop_table("llm_blobs")
    op.drop_table("llm_exchanges")
