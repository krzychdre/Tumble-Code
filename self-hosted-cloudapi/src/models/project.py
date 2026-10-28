"""Projects and the folders bound to them (cross-session recall).

A project is what a set of tasks has in common across machines and people: a
git repository, or a folder without git. Every project belongs to one tenant,
an organization or one user's personal space, and nothing is ever shared
across tenants. See ai_plans/2026-10-26_18-22_cross-session-recall.md.
"""

from sqlalchemy import Column, ForeignKey, Index, String, func

from src.models.base import Base, TimestampMixin, generate_id

# Who may find a project's sessions (services/projects explains each value).
SCOPE_NONE = "none"
SCOPE_OWNER = "owner"
SCOPE_MEMBERS = "members"
SCOPE_ORGANIZATION = "organization"


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: generate_id("prj_"))
    # The organization id, or the user id for a personal project: the one
    # column every recall query and the uniqueness of `key` start from.
    tenant_id = Column(String, nullable=False)
    organization_id = Column(
        String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    # Whoever's folder created the project; the owner of a personal one.
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Normalized git remote ("github.com/qub-it/roo-code"), or
    # "folder:<sha256>" for a folder without one (services/projects).
    key = Column(String, nullable=False)
    # Unique in the tenant, case-insensitively (services/projects.name_candidates).
    name = Column(String, nullable=False)
    # The default name another project of the tenant had already when this
    # one was created; the project page shows it until someone saves a name.
    wanted_name = Column(String, nullable=True)
    recall_scope = Column(
        String, nullable=False, default=SCOPE_NONE, server_default=SCOPE_NONE
    )

    __table_args__ = (
        Index("uq_projects_tenant_key", "tenant_id", "key", unique=True),
        Index("uq_projects_tenant_name", tenant_id, func.lower(name), unique=True),
    )

    @property
    def key_label(self) -> str:
        """The key as the pages show it: a folder key is a hash."""
        return "folder without git" if self.key.startswith("folder:") else self.key


class ProjectBinding(Base, TimestampMixin):
    """One user's folder, in one tenant, is that project."""

    __tablename__ = "project_bindings"

    id = Column(String, primary_key=True, default=lambda: generate_id("pb_"))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String, nullable=False)
    workspace_path = Column(String, nullable=False)
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index(
            "uq_project_bindings_folder",
            "user_id",
            "tenant_id",
            "workspace_path",
            unique=True,
        ),
    )
