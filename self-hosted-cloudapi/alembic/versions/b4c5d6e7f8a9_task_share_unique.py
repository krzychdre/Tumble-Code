"""Make task_shares unique per task and deduplicate existing rows.

POST /api/extension/share decided between "update the existing share" and
"insert a new one" with a non-atomic SELECT-then-INSERT: two concurrent
requests (a double click, two browser tabs) both saw "no share yet" and both
inserted, leaving two ``task_shares`` rows for one task. Every reader of a
task's share resolves it with ``scalar_one_or_none()`` (``shared_view_access``
and friends), so duplicates did not just waste a row — they made the shared
page raise ``MultipleResultsFound`` until the rows were cleaned up by hand.

This deduplicates existing rows and adds a unique index on
``task_shares.task_id``, so the service's ``ON CONFLICT DO NOTHING`` insert
(service change shipped together with this migration) is race-proof: exactly
one racing caller's row lands, the rest adopt it.

Dedup keeps the row with the LOWEST id, which mirrors the extension's
sequential behaviour: the first share request a task ever got is the one whose
share URL may already be in someone's hands. All duplicate rows carry the same
``share_url`` (it is derived from the task id, not the row), so nothing but
``visibility`` can meaningfully differ — the oldest row's value wins.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-27 12:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None

_INDEX = "uq_task_shares_task_id"


def upgrade() -> None:
    # Collapse duplicates that the select-then-insert race may already have
    # created, keeping the first row ever inserted (lowest id). SQLite (the
    # test database) cannot run the DELETE ... USING form, so both dialects
    # use a portable subquery delete — task_shares is tiny (one row per
    # shared task), so the plan difference does not matter.
    op.execute(
        """
        DELETE FROM task_shares
        WHERE id NOT IN (
            SELECT MIN(id) FROM task_shares GROUP BY task_id
        )
        """
    )

    op.create_index(_INDEX, "task_shares", ["task_id"], unique=True)


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="task_shares")
