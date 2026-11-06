"""A random token names a share link instead of the task id.

``/shared/{task_id}`` let a re-share revive a revoked link and made the task
id the secret. The token is new on every share; links in the old form stop
working. Existing rows get a fresh token and their stored ``share_url`` is
rewritten to it. create_all builds the same schema on a FRESH database
(src/db_bootstrap.py).

Revision ID: b5c6d7e8f9a0
Revises: a1c2e3f4b5d6
Create Date: 2026-11-06 18:00:00.000000

"""

import secrets

import sqlalchemy as sa
from alembic import op

revision = "b5c6d7e8f9a0"
down_revision = "a1c2e3f4b5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("task_shares", sa.Column("share_token", sa.String(), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, task_id, share_url FROM task_shares"))
    for share_id, task_id, share_url in rows.all():
        token = secrets.token_urlsafe(32)
        if share_url is not None:
            share_url = share_url.replace(f"/shared/{task_id}", f"/shared/{token}")
        conn.execute(
            sa.text(
                "UPDATE task_shares SET share_token = :token, share_url = :url "
                "WHERE id = :id"
            ),
            {"token": token, "url": share_url, "id": share_id},
        )
    with op.batch_alter_table("task_shares") as batch:
        batch.alter_column("share_token", existing_type=sa.String(), nullable=False)
    op.create_index(
        "uq_task_shares_share_token", "task_shares", ["share_token"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_task_shares_share_token", table_name="task_shares")
    with op.batch_alter_table("task_shares") as batch:
        batch.drop_column("share_token")
