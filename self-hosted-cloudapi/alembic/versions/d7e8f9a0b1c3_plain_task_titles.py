"""Re-derive every task's title and excerpt from its opening prompt only.

Two defects reached the stored titles. A title kept the Markdown of the prompt
(``**one**``, backticks, ``# heading``), which every page then showed raw. And a
task whose opening prompt never reached the cloud (the bridge connected after
the task started) took its title from the first later message with text: an
``api_req_retry_delayed`` ("423", "OpenAI completion error: Connection error."),
a ``reasoning`` trace or a ``user_feedback``.

services/task_summary now reads the title from the opening prompt alone, as
plain text. This applies the same rule to the stored rows; the opening prompt
is the earliest row, so one row per task is read. A task without it goes back to
no title (shown as "Untitled task"). The downgrade keeps the new titles: the
code before this only writes a title where there is none.

Revision ID: d7e8f9a0b1c3
Revises: c6d7e8f9a0b1
Create Date: 2026-11-25 14:30:00.000000

"""

import json

from alembic import op
import sqlalchemy as sa

revision = "d7e8f9a0b1c3"
down_revision = "c6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Imported here as e1f2a3b4c5d6 does: a revision file is loaded with every
    # alembic command, and only this upgrade needs the app's code.
    from src.services.task_summary import derive_prompt, derive_title, opening_query

    conn = op.get_bind()
    head_sql = (
        "SELECT message_data FROM task_messages WHERE task_id = :tid "
        "ORDER BY message_ts NULLS LAST, id LIMIT 1"
        if conn.dialect.name == "postgresql"
        else "SELECT message_data FROM task_messages WHERE task_id = :tid "
        "ORDER BY message_ts IS NULL, message_ts, id LIMIT 1"
    )
    tasks = conn.execute(sa.text("SELECT id, title, prompt_excerpt FROM tasks")).all()
    for task_id, title, excerpt in tasks:
        row = conn.execute(sa.text(head_sql), {"tid": task_id}).first()
        if row is None:
            continue
        try:
            first = json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            first = None
        messages = [first] if isinstance(first, dict) else []
        if opening_query(messages):
            new_title, new_excerpt = derive_title(messages), derive_prompt(messages)
        else:
            new_title, new_excerpt = None, None
        if (new_title, new_excerpt) != (title, excerpt):
            conn.execute(
                sa.text(
                    "UPDATE tasks SET title = :title, prompt_excerpt = :excerpt "
                    "WHERE id = :tid"
                ),
                {"title": new_title, "excerpt": new_excerpt, "tid": task_id},
            )


def downgrade() -> None:
    pass
