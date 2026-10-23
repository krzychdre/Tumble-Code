"""Give tasks.parent_task_id's foreign key the name migration a7b8c9d0e1f2 uses.

a7b8c9d0e1f2 creates the key as ``fk_tasks_parent_task_id`` and its downgrade
drops it by that name. A database built by create_all got Postgres' default
name, ``tasks_parent_task_id_fkey``, because the model did not name the key, so
``alembic downgrade`` failed there. The model now names it; this renames the key
of a create_all database built before that. A migrated database, and a create_all
database built after it, already carry the name and are left alone.

Postgres only: SQLite cannot rename a constraint in place, and a SQLite database
reaches this name through a7b8c9d0e1f2's batch rebuild.

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-10-24 00:39:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "a9b0c1d2e3f4"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_parent_task_id_fkey'
            ) THEN
                ALTER TABLE tasks RENAME CONSTRAINT tasks_parent_task_id_fkey TO fk_tasks_parent_task_id;
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    # The new name is the one a7b8c9d0e1f2's downgrade drops: keep it.
    pass
