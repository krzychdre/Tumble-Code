"""Store a run's duration as its wall time, not the sum of its requests.

tasks.run_duration_ms summed the duration of every member's model requests,
so the requests of subtasks running in parallel counted once per subtask: a
run whose three subtasks started together showed 5260 s for 2374 s of wall
time. services/task_tree now stores how long at least one request of the run
was running, from the timed messages of its members (task_messages with a
duration_ms): a condense message is said when its request ends, every other
one when its request starts, and one without a time overlaps nothing.

This adds ix_task_messages_timed, which that query reads, and stores the new
duration of every task in one UPDATE, the members walked as f0a1b2c3d4e5 walks
them. The downgrade keeps the stored durations: the code before this sums
them again as each run changes.

Revision ID: f3c4d5e6a7b8
Revises: f2b3c4d5e6a7
Create Date: 2026-10-28 16:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "f3c4d5e6a7b8"
down_revision = "f2b3c4d5e6a7"
branch_labels = None
depends_on = None

# task_tree.RUN_DEPTH_MAX and session_quality.KIND_CONDENSE.
RUN_DEPTH_MAX = 128
KIND_CONDENSE = "condense"


def upgrade() -> None:
    op.create_index(
        "ix_task_messages_timed",
        "task_messages",
        ["task_id", "message_ts", "duration_ms", "q_kind"],
        postgresql_where=sa.text("duration_ms > 0"),
    )
    # Ordered by start, each request adds the part of it past the latest end
    # of the requests that started before it.
    op.get_bind().execute(
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
            requests AS (
                SELECT d.run_id,
                       CASE WHEN q.q_kind = '{KIND_CONDENSE}'
                            THEN q.message_ts - q.duration_ms
                            ELSE q.message_ts END AS start_ms,
                       q.duration_ms
                FROM distinct_members d
                JOIN task_messages q
                  ON q.task_id = d.member_id AND q.duration_ms > 0
            ),
            ordered AS (
                SELECT run_id, start_ms, start_ms + duration_ms AS end_ms,
                       duration_ms,
                       MAX(start_ms + duration_ms) OVER (
                           PARTITION BY run_id ORDER BY start_ms
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                       ) AS earlier_end_ms
                FROM requests
            ),
            walls AS (
                SELECT run_id,
                       SUM(CASE WHEN earlier_end_ms IS NULL OR start_ms IS NULL
                                     OR start_ms >= earlier_end_ms
                                THEN duration_ms
                                WHEN end_ms > earlier_end_ms
                                THEN end_ms - earlier_end_ms
                                ELSE 0 END) AS duration_ms
                FROM ordered
                GROUP BY run_id
            )
            UPDATE tasks SET run_duration_ms = coalesce(walls.duration_ms, 0)
            FROM tasks AS run
            LEFT JOIN walls ON walls.run_id = run.id
            WHERE tasks.id = run.id
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_task_messages_timed", table_name="task_messages")
