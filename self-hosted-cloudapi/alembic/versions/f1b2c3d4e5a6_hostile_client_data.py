"""Clear what a hostile client could store before ingest refused it.

* A message time outside 0..2100-01-01 (telemetry_service.MESSAGE_TS_MAX):
  the recall search turned the card's last time into a date and failed for
  every member who could see it. The time goes (NULL, as a message without
  one), its task's first and last times are taken again, and a card keeps
  the task's last time.
* A parent link between two accounts' tasks (task_tree.record_relation now
  links only the sender's own tasks): it hid the other account's run from
  its list and showed its title in a stranger's breadcrumb. The link goes.
  Run totals do not change: a run never counted another owner's task.

Revision ID: f1b2c3d4e5a6
Revises: f1a2b3c4d5e6
Create Date: 2026-10-28 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "f1b2c3d4e5a6"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None

MESSAGE_TS_MAX = 4_102_444_800_000
OUTSIDE = f"NOT BETWEEN 0 AND {MESSAGE_TS_MAX}"


def upgrade() -> None:
    conn = op.get_bind()
    task_ids = [
        row[0]
        for row in conn.execute(
            sa.text(
                f"SELECT DISTINCT task_id FROM task_messages WHERE message_ts {OUTSIDE}"
            )
        )
    ]
    if task_ids:
        conn.execute(
            sa.text(
                f"UPDATE task_messages SET message_ts = NULL WHERE message_ts {OUTSIDE}"
            )
        )
        # task_summary.refresh_task_summary's span: a resume is not activity.
        span = (
            "(SELECT {fn}(m.message_ts) FROM task_messages m "
            "WHERE m.task_id = tasks.id AND m.q_kind IS DISTINCT FROM 'resume')"
        )
        conn.execute(
            sa.text(
                f"UPDATE tasks SET first_ts = {span.format(fn='min')}, "
                f"last_ts = {span.format(fn='max')} WHERE id IN :task_ids"
            ).bindparams(sa.bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
    conn.execute(
        sa.text(
            "UPDATE session_cards SET last_ts = coalesce("
            "(SELECT t.last_ts FROM tasks t WHERE t.id = session_cards.task_id), 0) "
            f"WHERE last_ts {OUTSIDE}"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE tasks SET parent_task_id = NULL WHERE user_id <> "
            "(SELECT p.user_id FROM tasks p WHERE p.id = tasks.parent_task_id)"
        )
    )


def downgrade() -> None:
    """Nothing to restore: the cleared values were never valid."""
