"""Projects, the folders bound to them, and the project of a task.

The first table of cross-session recall; see
ai_plans/2026-10-26_18-22_cross-session-recall.md. create_all builds the same
schema on a FRESH database (src/db_bootstrap.py). Existing tasks keep a NULL
project until their folder is reported again.

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-10-26 22:30:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "b0c1d2e3f4a5"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column(
            "organization_id",
            sa.String(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("recall_scope", sa.String(), server_default="none", nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_projects_user_id", "projects", ["user_id"])
    op.create_index(
        "uq_projects_tenant_key", "projects", ["tenant_id", "key"], unique=True
    )

    op.create_table(
        "project_bindings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("workspace_path", sa.String(), nullable=False),
        sa.Column(
            "project_id",
            sa.String(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        *_timestamps(),
    )
    op.create_index(
        "ix_project_bindings_project_id", "project_bindings", ["project_id"]
    )
    op.create_index(
        "uq_project_bindings_folder",
        "project_bindings",
        ["user_id", "tenant_id", "workspace_path"],
        unique=True,
    )

    op.add_column("tasks", sa.Column("project_id", sa.String(), nullable=True))
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    with op.batch_alter_table("tasks") as batch:
        batch.create_foreign_key(
            "fk_tasks_project_id",
            "projects",
            ["project_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint("fk_tasks_project_id", type_="foreignkey")
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_column("tasks", "project_id")
    op.drop_index("uq_project_bindings_folder", table_name="project_bindings")
    op.drop_index("ix_project_bindings_project_id", table_name="project_bindings")
    op.drop_table("project_bindings")
    op.drop_index("uq_projects_tenant_key", table_name="projects")
    op.drop_index("ix_projects_user_id", table_name="projects")
    op.drop_table("projects")
