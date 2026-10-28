"""Store each task's run totals and primary model on its row.

The task list shows, sorts and groups a run by what it consumed: the task plus
every task beneath it. It summed that with a recursive query over all of the
reader's tasks on every request, and split the ``models`` label of every
matching task in Python to group by model. This adds the columns the list now
reads instead:

  * tasks.run_cost, run_tokens, run_duration_ms: the task and every task
    beneath it of the same owner, the rule of the query they replace (a cycle
    in the client-supplied parent links counts each member once);
    services/task_tree.refresh_run_totals keeps them from now on;
  * tasks.primary_model: the first name of ``models`` (most-used first),
    written with it by services/model_attribution.refresh_task_models.

and backfills them in one UPDATE, so each row is rewritten once. The index on
parent_task_id becomes ix_tasks_parent_user (parent_task_id, user_id): every
walk down a tree, the one that keeps these totals included, looks up a task's
children of one owner.

The stored figures and links are what clients sent, any of them hand-made.
Message figures outside the bounds ingest keeps from now on
(task_summary.message_metrics) read as 0 and their tasks are summed again
first, so no run total can overflow; and a run reaches at most RUN_DEPTH_MAX
levels down, as task_tree walks it, so a chain or cycle a client built cannot
make the backfill quadratic in its length. A link to a parent id longer than
task_tree.TASK_ID_MAX is cut: beside its owner it would not fit the new index.

Revision ID: f0a1b2c3d4e5
Revises: e8f9a0b1c2d3
Create Date: 2026-10-28 00:30:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "f0a1b2c3d4e5"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None

# utils/format's bounds of one request, task_tree.RUN_DEPTH_MAX and
# task_tree.TASK_ID_MAX.
BOUNDS = (
    ("tokens_in", 10**9),
    ("tokens_out", 10**9),
    ("cache_reads", 10**9),
    ("cache_writes", 10**9),
    ("cost", 10_000),
    ("duration_ms", 24 * 3600 * 1000),
)
RUN_DEPTH_MAX = 128
TASK_ID_MAX = 256

# model_attribution.primary_model as it was when this ran: the label's first
# comma-separated name, trimmed.
FIRST_NAME = {
    "postgresql": "btrim(split_part(models, ',', 1))",
    "sqlite": "trim(substr(models, 1, instr(models || ',', ',') - 1))",
}


def upgrade() -> None:
    op.add_column("tasks", sa.Column("primary_model", sa.String(), nullable=True))
    op.add_column(
        "tasks",
        sa.Column("run_cost", sa.Float(), nullable=False, server_default="0"),
    )
    for name in ("run_tokens", "run_duration_ms"):
        op.add_column(
            "tasks",
            sa.Column(name, sa.BigInteger(), nullable=False, server_default="0"),
        )

    conn = op.get_bind()
    _bound_message_figures(conn)
    # A parent id this long, which only a hand-made request stores, would not
    # fit ix_tasks_parent_user beside its owner: the link goes, as ingest
    # ignores it from now on.
    conn.execute(
        sa.text(
            f"UPDATE tasks SET parent_task_id = NULL "
            f"WHERE length(parent_task_id) > {TASK_ID_MAX}"
        )
    )
    conn.execute(
        sa.text(
            f"DELETE FROM task_relations WHERE length(child_task_id) > {TASK_ID_MAX} "
            f"OR length(parent_task_id) > {TASK_ID_MAX}"
        )
    )
    conn.execute(
        sa.text(
            f"""
            WITH RECURSIVE members(run_id, member_id, user_id, depth) AS (
                SELECT id, id, user_id, 0 FROM tasks
                UNION ALL
                SELECT m.run_id, c.id, m.user_id, m.depth + 1
                FROM tasks c
                JOIN members m
                  ON c.parent_task_id = m.member_id AND c.user_id = m.user_id
                WHERE m.depth < {RUN_DEPTH_MAX}
            ),
            distinct_members AS (SELECT DISTINCT run_id, member_id FROM members),
            totals AS (
                SELECT m.run_id,
                       SUM(t.cost) AS cost,
                       SUM(t.tokens_in + t.tokens_out) AS tokens,
                       SUM(t.duration_ms) AS duration_ms
                FROM distinct_members m JOIN tasks t ON t.id = m.member_id
                GROUP BY m.run_id
            )
            UPDATE tasks SET
                run_cost = totals.cost,
                run_tokens = totals.tokens,
                run_duration_ms = totals.duration_ms,
                primary_model = {FIRST_NAME[conn.dialect.name]}
            FROM totals
            WHERE tasks.id = totals.run_id
            """
        )
    )

    op.create_index("ix_tasks_parent_user", "tasks", ["parent_task_id", "user_id"])
    op.drop_index("ix_tasks_parent_task_id", table_name="tasks")


def _bound_message_figures(conn) -> None:
    """Set the message figures outside the bounds to 0 and sum their tasks'
    own figures again, as refresh_task_summary sums them."""
    outside = " OR ".join(f"{name} NOT BETWEEN 0 AND {top}" for name, top in BOUNDS)
    task_ids = [
        row[0]
        for row in conn.execute(
            sa.text(f"SELECT DISTINCT task_id FROM task_messages WHERE {outside}")
        )
    ]
    if not task_ids:
        return
    conn.execute(
        sa.text(
            "UPDATE task_messages SET "
            + ", ".join(
                f"{name} = CASE WHEN {name} BETWEEN 0 AND {top} THEN {name} ELSE 0 END"
                for name, top in BOUNDS
            )
            + f" WHERE {outside}"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE tasks SET "
            + ", ".join(
                f"{name} = (SELECT coalesce(sum(m.{name}), 0) FROM task_messages m "
                "WHERE m.task_id = tasks.id)"
                for name, _top in BOUNDS
            )
            + " WHERE id IN :task_ids"
        ).bindparams(sa.bindparam("task_ids", expanding=True)),
        {"task_ids": task_ids},
    )


def downgrade() -> None:
    op.create_index("ix_tasks_parent_task_id", "tasks", ["parent_task_id"])
    op.drop_index("ix_tasks_parent_user", table_name="tasks")
    for name in ("run_duration_ms", "run_tokens", "run_cost", "primary_model"):
        op.drop_column("tasks", name)
