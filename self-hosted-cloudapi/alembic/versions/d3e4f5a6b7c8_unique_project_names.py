"""Project names unique in their tenant, case-insensitively; projects.wanted_name.

Two people's folders without git of the same name were two projects of one
name in an organization. Every project after the first (oldest) of a name
takes the first free of services/projects.name_candidates, as a new project
does, and keeps the name it had in ``wanted_name``; then the unique index
``(tenant_id, lower(name))`` goes on. create_all builds the same schema on a
FRESH database (src/db_bootstrap.py).

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-10-27 14:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

from src.services.projects import name_candidates, name_qualifier

revision = "d3e4f5a6b7c8"
down_revision = "c2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("wanted_name", sa.String(), nullable=True))
    conn = op.get_bind()
    duplicates = conn.execute(
        sa.text(
            """
            SELECT p.id, p.tenant_id, p.key, p.name, u.email
            FROM projects p JOIN users u ON u.id = p.user_id
            WHERE EXISTS (
                SELECT 1 FROM projects q
                WHERE q.tenant_id = p.tenant_id AND lower(q.name) = lower(p.name)
                  AND (q.created_at < p.created_at
                       OR (q.created_at = p.created_at AND q.id < p.id))
            )
            ORDER BY p.created_at, p.id
            """
        )
    ).all()
    taken = sa.text(
        "SELECT 1 FROM projects WHERE tenant_id = :tenant AND lower(name) = lower(:name)"
    )
    for project_id, tenant, key, wanted, email in duplicates:
        for name in name_candidates(wanted, name_qualifier(key, email)):
            if conn.execute(taken, {"tenant": tenant, "name": name}).first() is None:
                break
        conn.execute(
            sa.text(
                "UPDATE projects SET name = :name, wanted_name = :wanted WHERE id = :id"
            ),
            {"name": name, "wanted": wanted, "id": project_id},
        )
    op.create_index(
        "uq_projects_tenant_name",
        "projects",
        ["tenant_id", sa.text("lower(name)")],
        unique=True,
    )


def downgrade() -> None:
    # The given names stay: the schema before allows them as well.
    op.drop_index("uq_projects_tenant_name", table_name="projects")
    op.drop_column("projects", "wanted_name")
