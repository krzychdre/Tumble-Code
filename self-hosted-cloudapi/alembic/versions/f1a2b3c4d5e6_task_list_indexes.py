"""Indexes for the task list and the quality panel of the metrics page.

* ix_tasks_user_roots, ix_tasks_org_roots: a user's or an organization's runs
  (no parent), newest first. Partial on Postgres. They serve the list's pages
  of runs and the quality panel's runs of a period.
* ix_tasks_project_user replaces ix_tasks_project_id: the list's project names
  probe it once per project the reader may see, which used to read every
  task of each organization project to find the reader's.
* ix_tasks_user_models: the model picker's distinct labels of a user, read
  from the index alone. Postgres refuses an entry over 2704 bytes, and the
  base code stored labels of any length (a model id of kilobytes, a task
  that ran through hundreds of models), so a longer label is first rebuilt
  with the rules ingest builds labels by now.
* ix_tasks_user_id is dropped: ix_tasks_user_updated leads with user_id and
  serves every lookup it served.

create_all builds the same indexes on a FRESH database (models/task). Plain
CREATE INDEX: the table is small on a live deployment.

Revision ID: f1a2b3c4d5e6
Revises: f0a1b2c3d4e5
Create Date: 2026-10-28 00:30:00.000000

"""

import unicodedata

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None

ROOTS = sa.text("parent_task_id IS NULL")
# model_attribution.LABEL_MAX_BYTES and telemetry_vocab.NAME_MAX_BYTES.
LABEL_MAX_BYTES = 2000
NAME_MAX_BYTES = 256


def upgrade() -> None:
    op.create_index(
        "ix_tasks_user_roots",
        "tasks",
        ["user_id", "updated_at"],
        postgresql_where=ROOTS,
    )
    op.create_index(
        "ix_tasks_org_roots",
        "tasks",
        ["organization_id", "updated_at"],
        postgresql_where=ROOTS,
    )
    op.create_index("ix_tasks_project_user", "tasks", ["project_id", "user_id"])
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    _bound_labels(op.get_bind())
    op.create_index("ix_tasks_user_models", "tasks", ["user_id", "models"])
    op.drop_index("ix_tasks_user_id", table_name="tasks")


def _bound_labels(conn) -> None:
    """Rebuild every label over LABEL_MAX_BYTES, and its primary model.

    Its names are cleaned as telemetry_vocab.clean_name cleans a model id,
    and kept in order (most-used first) while they fit, as
    model_attribution.models_label keeps them.
    """
    rows = conn.execute(
        # A label of at most a quarter of the bytes in characters fits.
        sa.text("SELECT id, models FROM tasks WHERE length(models) > :chars"),
        {"chars": LABEL_MAX_BYTES // 4},
    ).all()
    updates = []
    for task_id, models in rows:
        if len(models.encode()) <= LABEL_MAX_BYTES:
            continue
        names = list(dict.fromkeys(filter(None, map(_name, models.split(",")))))
        label = None
        for name in names:
            longer = name if label is None else f"{label}, {name}"
            if len(longer.encode()) > LABEL_MAX_BYTES:
                break
            label = longer
        updates.append(
            {"id": task_id, "models": label, "primary": names[0] if names else None}
        )
    if updates:
        conn.execute(
            sa.text(
                "UPDATE tasks SET models = :models, primary_model = :primary "
                "WHERE id = :id"
            ),
            updates,
        )


def _name(value: str):
    """telemetry_vocab.clean_name as it was when this ran."""
    kept = "".join(
        ch for ch in value if unicodedata.category(ch) not in ("Cc", "Cf", "Cs")
    )
    return kept.encode()[:NAME_MAX_BYTES].decode(errors="ignore").strip() or None


def downgrade() -> None:
    op.create_index("ix_tasks_user_id", "tasks", ["user_id"])
    op.drop_index("ix_tasks_user_models", table_name="tasks")
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    op.drop_index("ix_tasks_project_user", table_name="tasks")
    op.drop_index("ix_tasks_org_roots", table_name="tasks")
    op.drop_index("ix_tasks_user_roots", table_name="tasks")
