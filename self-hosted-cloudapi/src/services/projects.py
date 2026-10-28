"""Projects: which project a folder is, and who may change a project.

Resolution, when a client reports a folder (bridge register, GET
/api/recall/context):

1. the user's binding of that folder in that tenant decides;
2. otherwise a git remote names the project: the tenant's project with that
   key, created on first sight, so every clone and worktree of a repository,
   by anyone in the organization, is the same project;
3. otherwise the folder becomes a project of its own (key ``folder:<hash>``).

The new binding also claims the user's earlier tasks of that folder in that
tenant that have no project yet. A folder without git is shared with others
by merging their folder projects into one on the projects page.

The tenant is the organization active in the client (its token's org claim),
or the user's personal space. Managing a project (name, recall scope, merge)
is for the owner of a personal project and for the admins of an
organization's.
"""

import hashlib
import json
import posixpath
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import dialect_insert
from src.models.event import TelemetryEvent
from src.models.llm_exchange import LlmExchange
from src.models.organization import Membership, Organization
from src.models.project import (
    SCOPE_MEMBERS,
    SCOPE_NONE,
    SCOPE_ORGANIZATION,
    SCOPE_OWNER,
    Project,
    ProjectBinding,
)
from src.models.task import Task
from src.models.user import User
from src.services.recall_cards import drop_project_cards, mark_dirty, queue_project
from src.services.organizations import ROLE_ADMIN
from src.services.user_service import get_user_memberships
from src.utils.pagination import paginate

NAME_MAX = 100

# The choices each kind of tenant offers, in the order the page lists them.
ORGANIZATION_SCOPES = {
    SCOPE_NONE: "Off",
    SCOPE_OWNER: "Only my own sessions",
    SCOPE_MEMBERS: "Everyone's sessions in this project",
    SCOPE_ORGANIZATION: "Whole organization",
}
PERSONAL_SCOPES = {
    SCOPE_NONE: "Off",
    SCOPE_OWNER: "Only this project",
    SCOPE_ORGANIZATION: "All my projects",
}


class ProjectError(Exception):
    """A refused change. ``code`` keys the message the page shows."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def tenant_of(user_id: str, org_id: Optional[str]) -> str:
    return org_id or user_id


def repository_key(repository_url: str) -> str:
    """``https://user@GitHub.com/QUB-IT/Roo-Code.git/`` -> ``github.com/qub-it/roo-code``.

    The client sends its remote already converted to https; scheme,
    credentials, a trailing ``.git`` and slashes go, and case is folded
    because the hosts treat paths case-insensitively.
    """
    rest = repository_url.strip().split("://", 1)[-1]
    rest = rest.rsplit("@", 1)[-1].rstrip("/")
    if rest.endswith(".git"):
        rest = rest[: -len(".git")]
    return rest.lower()


def folder_key(user_id: str, workspace_path: str) -> str:
    digest = hashlib.sha256(f"{user_id}\0{workspace_path}".encode()).hexdigest()
    return f"folder:{digest[:32]}"


def _default_name(repository_url: str, workspace_path: str) -> str:
    if repository_url:
        source = repository_url.strip().rstrip("/")
        name = posixpath.basename(source)
        return name[: -len(".git")] if name.endswith(".git") else name
    return posixpath.basename(workspace_path.replace("\\", "/").rstrip("/"))


def new_project_identity(
    user_id: str, workspace_path: str, repository_url: str
) -> tuple[str, str]:
    """The key and default name of the project an unbound folder becomes."""
    key = (
        repository_key(repository_url)
        if repository_url
        else folder_key(user_id, workspace_path)
    )
    return key, _default_name(repository_url, workspace_path)[:NAME_MAX]


async def resolve_project(
    db: AsyncSession,
    user_id: str,
    org_id: Optional[str],
    workspace_path: str,
    repository_url: str,
) -> Project:
    """The project of the user's folder in the tenant, created and bound if new."""
    tenant = tenant_of(user_id, org_id)
    bound = await _bound_project_id(db, user_id, tenant, workspace_path)
    if bound is None:
        project_id = await _project_for_folder(
            db, user_id, org_id, workspace_path, repository_url
        )
        bound = await _bind_folder(db, user_id, org_id, workspace_path, project_id)
    return await db.get(Project, bound)


async def bind_recorded_folder(
    db: AsyncSession,
    user_id: str,
    org_id: Optional[str],
    workspace_path: str,
    task_id: str,
    parent_task_id: Optional[str],
) -> None:
    """Bind the folder of a recorded exchange when no window ever reported it.

    An agent's worktree runs tasks without a window of its own. Its project
    is the git remote the task's telemetry reported; without one, the project
    of the parent task's folder (a worktree of the parent's repository);
    without that, a folder project.
    """
    tenant = tenant_of(user_id, org_id)
    if await _bound_project_id(db, user_id, tenant, workspace_path) is not None:
        return
    # One round trip: the task's latest event naming its remote, and the
    # project of the parent task's folder (none without a parent).
    properties, parent_project = (
        await db.execute(
            select(
                select(TelemetryEvent.properties)
                .where(
                    TelemetryEvent.task_id == task_id,
                    TelemetryEvent.user_id == user_id,
                    TelemetryEvent.properties.contains('"repositoryUrl"'),
                )
                .order_by(TelemetryEvent.created_at.desc())
                .limit(1)
                .scalar_subquery(),
                select(ProjectBinding.project_id)
                .join(LlmExchange, exchange_binding())
                .where(
                    LlmExchange.user_id == user_id,
                    LlmExchange.task_id == parent_task_id,
                    ProjectBinding.tenant_id == tenant,
                )
                .limit(1)
                .scalar_subquery(),
            )
        )
    ).one()
    repository_url = json.loads(properties)["repositoryUrl"] if properties else ""
    if repository_url or parent_project is None:
        project_id = await _project_for_folder(
            db, user_id, org_id, workspace_path, repository_url
        )
    else:
        project_id = parent_project
    await _bind_folder(db, user_id, org_id, workspace_path, project_id)


def exchange_binding():
    """The one rule that maps a recorded exchange to its project: the binding
    of its user's folder in its tenant (a join condition)."""
    return and_(
        ProjectBinding.user_id == LlmExchange.user_id,
        ProjectBinding.tenant_id
        == func.coalesce(LlmExchange.organization_id, LlmExchange.user_id),
        ProjectBinding.workspace_path == LlmExchange.workspace_path,
    )


async def _project_for_folder(
    db: AsyncSession,
    user_id: str,
    org_id: Optional[str],
    workspace_path: str,
    repository_url: str,
) -> str:
    """The id of the tenant's project an unbound folder becomes, created on first sight."""
    tenant = tenant_of(user_id, org_id)
    key, name = new_project_identity(user_id, workspace_path, repository_url)
    await db.execute(
        dialect_insert(db)(Project)
        .values(
            tenant_id=tenant,
            organization_id=org_id,
            user_id=user_id,
            key=key,
            name=name,
        )
        .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
    )
    return await db.scalar(
        select(Project.id).where(Project.tenant_id == tenant, Project.key == key)
    )


async def _bind_folder(
    db: AsyncSession,
    user_id: str,
    org_id: Optional[str],
    workspace_path: str,
    project_id: str,
) -> str:
    """Bind the folder and claim its earlier tasks; returns the project it is bound to."""
    tenant = tenant_of(user_id, org_id)
    # Concurrent reports of one folder (register and context at once) bind it
    # once; whichever binding won is the answer.
    await db.execute(
        dialect_insert(db)(ProjectBinding)
        .values(
            user_id=user_id,
            tenant_id=tenant,
            workspace_path=workspace_path,
            project_id=project_id,
        )
        .on_conflict_do_nothing(
            index_elements=["user_id", "tenant_id", "workspace_path"]
        )
    )
    bound = await _bound_project_id(db, user_id, tenant, workspace_path)
    claimed = (
        (
            await db.execute(
                select(Task.id).where(
                    Task.user_id == user_id,
                    Task.workspace_path == workspace_path,
                    Task.project_id.is_(None),
                    _task_in_tenant(org_id),
                )
            )
        )
        .scalars()
        .all()
    )
    await db.execute(
        update(Task)
        .where(Task.id.in_(claimed))
        .values(project_id=bound)
        .execution_options(synchronize_session=False)
    )
    if claimed and (await db.get(Project, bound)).recall_scope != SCOPE_NONE:
        for task_id in claimed:
            await mark_dirty(db, task_id)
    return bound


async def project_id_for_folder(
    db: AsyncSession, user_id: str, org_id: Optional[str], workspace_path: str
) -> Optional[str]:
    """The project a new task of this folder belongs to, if the folder is bound."""
    return await _bound_project_id(
        db, user_id, tenant_of(user_id, org_id), workspace_path
    )


async def _bound_project_id(
    db: AsyncSession, user_id: str, tenant: str, workspace_path: str
) -> Optional[str]:
    return await db.scalar(
        select(ProjectBinding.project_id).where(
            ProjectBinding.user_id == user_id,
            ProjectBinding.tenant_id == tenant,
            ProjectBinding.workspace_path == workspace_path,
        )
    )


def _task_in_tenant(org_id: Optional[str]):
    if org_id is None:
        return Task.organization_id.is_(None)
    return Task.organization_id == org_id


# --- the projects pages -----------------------------------------------------

PAGE_SIZE = 25

# The list's Recall filter: its value in the URL and the projects it keeps.
RECALL_FILTERS = {
    "off": Project.recall_scope == SCOPE_NONE,
    "on": Project.recall_scope != SCOPE_NONE,
}


@dataclass(frozen=True)
class Space:
    """The reader's personal space or one of their organizations. ``key`` is
    the list's Space filter value: ``personal`` or the organization id."""

    key: str
    tenant_id: str
    title: str


@dataclass(frozen=True)
class ProjectRow:
    project: Project
    space: str
    task_count: int


@dataclass(frozen=True)
class ProjectAccess:
    """A project the reader may see, the title of its space, and whether the
    reader may change it."""

    project: Project
    space: str
    can_manage: bool


@dataclass(frozen=True)
class Folder:
    path: str
    email: str


async def spaces_for(db: AsyncSession, user_id: str) -> list[Space]:
    """The reader's personal space, then each of their organizations by name."""
    memberships = await get_user_memberships(db, user_id)
    return [Space("personal", user_id, "Personal")] + [
        Space(m.organization_id, m.organization_id, m.organization.name)
        for m in sorted(memberships, key=lambda m: m.organization.name.lower())
    ]


async def project_list_page(
    db: AsyncSession,
    spaces: list[Space],
    query: str,
    space: str,
    recall: str,
    page: int,
) -> tuple[list[ProjectRow], dict]:
    """One page of the projects of ``spaces`` matching the filters, by name,
    and the pager's fields (utils/pagination.paginate). ``space`` is a
    ``Space.key`` or empty for all of them."""
    titles = {s.tenant_id: s.title for s in spaces if space in ("", s.key)}
    conditions = [Project.tenant_id.in_(titles)]
    if query:
        conditions.append(
            or_(
                Project.name.icontains(query, autoescape=True),
                Project.key.icontains(query, autoescape=True),
            )
        )
    if recall in RECALL_FILTERS:
        conditions.append(RECALL_FILTERS[recall])
    total = await db.scalar(
        select(func.count()).select_from(Project).where(*conditions)
    )
    pager = paginate(total, page, PAGE_SIZE)
    rows = await db.execute(
        select(Project, _session_count())
        .where(*conditions)
        .order_by(func.lower(Project.name), Project.id)
        .limit(PAGE_SIZE)
        .offset(pager["offset"])
    )
    return [ProjectRow(p, titles[p.tenant_id], n) for p, n in rows], pager


def _session_count():
    return (
        select(func.count())
        .select_from(Task)
        .where(Task.project_id == Project.id)
        .scalar_subquery()
    )


async def project_access(
    db: AsyncSession, user_id: str, project_id: str
) -> Optional[ProjectAccess]:
    """The project when the reader may see it: their own personal project or
    a project of an organization they belong to, which its admins manage.
    None when unknown or foreign (the caller answers both the same way)."""
    project = await db.get(Project, project_id)
    if project is None:
        return None
    if project.organization_id is None:
        if project.user_id != user_id:
            return None
        return ProjectAccess(project, "Personal", True)
    membership = (
        await db.execute(
            select(Membership.role, Organization.name)
            .join(Organization, Organization.id == Membership.organization_id)
            .where(
                Membership.user_id == user_id,
                Membership.organization_id == project.organization_id,
            )
        )
    ).one_or_none()
    if membership is None:
        return None
    role, organization_name = membership
    return ProjectAccess(project, organization_name, role == ROLE_ADMIN)


async def manageable_project(
    db: AsyncSession, user_id: str, project_id: str
) -> Optional[Project]:
    """The project when the user may change it; None when unknown or not theirs
    to manage (the caller answers both the same way)."""
    access = await project_access(db, user_id, project_id)
    if access is None or not access.can_manage:
        return None
    return access.project


async def project_facts(db: AsyncSession, project: Project) -> tuple[int, list[Folder]]:
    """The project's session count and its folders, each with its user's e-mail."""
    task_count = await db.scalar(
        select(func.count()).select_from(Task).where(Task.project_id == project.id)
    )
    rows = await db.execute(
        select(ProjectBinding.workspace_path, User.email)
        .join(User, User.id == ProjectBinding.user_id)
        .where(ProjectBinding.project_id == project.id)
        .order_by(ProjectBinding.workspace_path)
    )
    return task_count, [Folder(path, email) for path, email in rows]


async def merge_names(db: AsyncSession, project: Project) -> list[str]:
    """The names the merge field offers: the space's other projects."""
    return list(
        (
            await db.execute(
                select(Project.name)
                .where(Project.tenant_id == project.tenant_id, Project.id != project.id)
                .distinct()
                .order_by(Project.name)
            )
        ).scalars()
    )


async def merge_target(db: AsyncSession, source: Project, name: str) -> Project:
    """The project of the source's space named ``name`` (case-insensitive)."""
    found = (
        (
            await db.execute(
                select(Project)
                .where(
                    Project.tenant_id == source.tenant_id,
                    Project.id != source.id,
                    func.lower(Project.name) == name.strip().lower(),
                )
                .limit(2)
            )
        )
        .scalars()
        .all()
    )
    if not found:
        raise ProjectError("bad_merge")
    if len(found) > 1:
        raise ProjectError("ambiguous_merge")
    return found[0]


def scopes_for(project: Project) -> dict[str, str]:
    return PERSONAL_SCOPES if project.organization_id is None else ORGANIZATION_SCOPES


async def update_project(
    db: AsyncSession, project: Project, name: str, scope: str
) -> None:
    name = name.strip()
    if not name or len(name) > NAME_MAX:
        raise ProjectError("bad_name")
    if scope not in scopes_for(project):
        raise ProjectError("bad_scope")
    was_off = project.recall_scope == SCOPE_NONE
    project.name = name
    project.recall_scope = scope
    await db.flush()
    if scope == SCOPE_NONE:
        await drop_project_cards(db, project.id)
    elif was_off:
        await queue_project(db, project.id)


async def merge_project(db: AsyncSession, source: Project, target: Project) -> None:
    """Move every folder and task of ``source`` into ``target`` (another
    project of its space, see ``merge_target``) and drop ``source``."""
    await db.execute(
        update(ProjectBinding)
        .where(ProjectBinding.project_id == source.id)
        .values(project_id=target.id)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(Task)
        .where(Task.project_id == source.id)
        .values(project_id=target.id)
        .execution_options(synchronize_session=False)
    )
    # The source's cards go with it (ON DELETE CASCADE); the target's scope now
    # decides about the moved tasks.
    await db.execute(delete(Project).where(Project.id == source.id))
    await db.flush()
    if target.recall_scope != SCOPE_NONE:
        await queue_project(db, target.id)
