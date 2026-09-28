"""SQLAlchemy ORM models."""

from src.models.base import Base, TimestampMixin
from src.models.user import User, Session, ClientToken, Ticket
from src.models.organization import Organization, Membership
from src.models.settings import OrganizationSettings, UserSettings
from src.models.task import Task, TaskMessage, TaskShare
from src.models.relation import TaskRelation
from src.models.event import TelemetryEvent
from src.models.oauth import AuthentikStateStore
from src.models.retention import RetentionPolicy

__all__ = [
    "Base",
    "TimestampMixin",
    "User",
    "Session",
    "ClientToken",
    "Ticket",
    "Organization",
    "Membership",
    "OrganizationSettings",
    "UserSettings",
    "Task",
    "TaskMessage",
    "TaskShare",
    "TaskRelation",
    "TelemetryEvent",
    "AuthentikStateStore",
    "RetentionPolicy",
    "RETIRED_TABLES",
    "include_name",
]

# Tables that existing deployments still have but no code reads any more. Their
# models are gone, so create_all no longer builds them on a FRESH database, but
# no migration drops them either: whatever rows a deployment holds stay put.
# alembic/env.py and the drift test skip them through include_name, so
# autogenerate never proposes a DROP TABLE for them.
#
# provider_configs: LLM proxy routing per organization; its last reader went
# with the cloud proxy provider (model removed in D6, 2026-09-28).
RETIRED_TABLES: frozenset[str] = frozenset({"provider_configs"})


def include_name(name, type_, parent_names) -> bool:
    """Alembic include_name hook: leave RETIRED_TABLES out of every comparison."""
    return not (type_ == "table" and name in RETIRED_TABLES)
