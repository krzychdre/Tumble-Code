"""Bind every folder already seen in tasks and recordings to a project.

Projects (b0c1d2e3f4a5) bind a folder when a window reports it, so the
folders of deleted worktrees would stay without a project forever. Each
(user, tenant, folder) of ``tasks`` and ``llm_exchanges`` gets the project
services/projects gives a folder recorded today (bind_recorded_folder): the
git remote the telemetry of its tasks reported last; without one, the project
of a parent task's folder; without that, a folder project. Then every task
of a bound folder takes its project. No schema change.

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-10-26 23:30:00.000000

"""

import json

from alembic import op
import sqlalchemy as sa

from src.models.base import generate_id
from src.services.projects import new_project_identity, tenant_of

revision = "c1d2e3f4a5b6"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # (user, tenant, path) -> its organization and its task ids.
    organization: dict[tuple, str | None] = {}
    tasks: dict[tuple, set[str]] = {}
    folder_of: dict[tuple[str, str], tuple] = {}
    rows = conn.execute(
        sa.text(
            "SELECT user_id, organization_id, workspace_path, id FROM tasks "
            "WHERE workspace_path IS NOT NULL "
            "UNION SELECT user_id, organization_id, workspace_path, task_id "
            "FROM llm_exchanges WHERE workspace_path IS NOT NULL"
        )
    )
    for user_id, org_id, path, task_id in rows:
        folder = (user_id, tenant_of(user_id, org_id), path)
        organization[folder] = org_id
        tasks.setdefault(folder, set()).add(task_id)
        folder_of[(user_id, task_id)] = folder

    # (user, task) -> (position, remote) of its latest event naming one.
    # Streamed: a task message event can carry a whole message. The option
    # goes on the statement: on the connection it would stream every later
    # statement too, and asyncpg cannot run an executemany on a server cursor.
    urls: dict[tuple[str, str], tuple[int, str]] = {}
    events = conn.execute(
        sa.text(
            "SELECT user_id, task_id, properties FROM telemetry_events "
            "WHERE task_id IS NOT NULL AND properties LIKE '%\"repositoryUrl\"%' "
            "ORDER BY created_at"
        ).execution_options(yield_per=1000)
    )
    for position, (user_id, task_id, properties) in enumerate(events):
        urls[(user_id, task_id)] = (position, json.loads(properties)["repositoryUrl"])

    parents = dict(
        conn.execute(
            sa.text("SELECT child_task_id, parent_task_id FROM task_relations")
        ).all()
    )
    projects = {
        (tenant, key): project_id
        for project_id, tenant, key in conn.execute(
            sa.text("SELECT id, tenant_id, key FROM projects")
        )
    }
    resolved = {
        (user_id, tenant, path): project_id
        for user_id, tenant, path, project_id in conn.execute(
            sa.text(
                "SELECT user_id, tenant_id, workspace_path, project_id "
                "FROM project_bindings"
            )
        )
    }
    new_projects: list[dict] = []
    new_bindings: list[dict] = []

    def project_of(folder: tuple, visiting: frozenset) -> str:
        if folder in resolved:
            return resolved[folder]
        user_id, tenant, path = folder
        task_ids = sorted(tasks[folder])
        named = [urls[(user_id, t)] for t in task_ids if (user_id, t) in urls]
        url = max(named)[1] if named else ""
        project_id = None
        if not url:
            for task_id in task_ids:
                parent = folder_of.get((user_id, parents.get(task_id)))
                if parent and parent[1] == tenant and parent not in visiting:
                    project_id = project_of(parent, visiting | {parent})
                    break
        if project_id is None:
            key, name = new_project_identity(user_id, path, url)
            project_id = projects.get((tenant, key))
            if project_id is None:
                project_id = projects[(tenant, key)] = generate_id("prj_")
                new_projects.append(
                    {
                        "id": project_id,
                        "tenant_id": tenant,
                        "organization_id": organization[folder],
                        "user_id": user_id,
                        "key": key,
                        "name": name,
                    }
                )
        resolved[folder] = project_id
        new_bindings.append(
            {
                "id": generate_id("pb_"),
                "user_id": user_id,
                "tenant_id": tenant,
                "workspace_path": path,
                "project_id": project_id,
            }
        )
        return project_id

    for folder in sorted(tasks):
        project_of(folder, frozenset({folder}))

    if new_projects:
        conn.execute(
            sa.text(
                "INSERT INTO projects (id, tenant_id, organization_id, user_id, key, name) "
                "VALUES (:id, :tenant_id, :organization_id, :user_id, :key, :name)"
            ),
            new_projects,
        )
    if new_bindings:
        conn.execute(
            sa.text(
                "INSERT INTO project_bindings (id, user_id, tenant_id, workspace_path, project_id) "
                "VALUES (:id, :user_id, :tenant_id, :workspace_path, :project_id)"
            ),
            new_bindings,
        )
    conn.execute(
        sa.text(
            """
            UPDATE tasks SET project_id = (
                SELECT b.project_id FROM project_bindings b
                WHERE b.user_id = tasks.user_id
                  AND b.tenant_id = COALESCE(tasks.organization_id, tasks.user_id)
                  AND b.workspace_path = tasks.workspace_path
            )
            WHERE project_id IS NULL AND workspace_path IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    # The bindings are indistinguishable from the ones windows made since.
    pass
