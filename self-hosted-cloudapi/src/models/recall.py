"""Session cards: what recall searches, one small row per task.

See ai_plans/2026-10-26_18-22_cross-session-recall.md, sections 4 and 5. A card
exists only for a task of a project whose recall scope is not ``none``.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    DDL,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    event,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.types import TypeDecorator

from src.models.base import Base, generate_id


class SearchVector(TypeDecorator):
    """A ``tsvector`` on Postgres; plain text elsewhere (the SQLite test
    database stores the normalized words and never searches them)."""

    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(TSVECTOR())
        return dialect.type_descriptor(Text())


class SessionCard(Base):
    __tablename__ = "session_cards"

    task_id = Column(
        String, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    tenant_id = Column(String, nullable=False)
    project_id = Column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    author_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    # What a reader sees: the title, the prompt, the completion results, the
    # user's replies and the touched paths (services/recall_cards).
    body = Column(Text, nullable=False)
    search_vector = Column(SearchVector, nullable=False)
    # ClineMessage.ts of the task's last message: the recency of a hit.
    last_ts = Column(BigInteger, nullable=False)
    completed = Column(Boolean, nullable=False)
    built_at = Column(DateTime(timezone=True), nullable=False)

    # The words with the project (the btree_gin extension indexes the plain
    # column): within one project the scan starts from that project's short
    # list instead of a long list of a common word. A tenant or author column
    # here selects almost nothing and only made the index slower.
    __table_args__ = (
        Index(
            "ix_session_cards_search",
            "project_id",
            "search_vector",
            postgresql_using="gin",
        ),
        # The newest matches first (services/recall_search, the candidates):
        # across the tenant's shared projects, and within one project.
        Index("ix_session_cards_recent", "tenant_id", "last_ts"),
        Index("ix_session_cards_project_recent", "project_id", "last_ts"),
    )


# create_all on a fresh Postgres database needs the extension before the index.
event.listen(
    SessionCard.__table__,
    "before_create",
    DDL("CREATE EXTENSION IF NOT EXISTS btree_gin").execute_if(dialect="postgresql"),
)


class RecallDirty(Base):
    """A task whose card must be rebuilt, and since when (services/recall_cards)."""

    __tablename__ = "recall_dirty"

    task_id = Column(String, primary_key=True)
    dirty_at = Column(DateTime(timezone=True), nullable=False, index=True)


class RecallLog(Base):
    """One search or read, to learn whether keyword search finds what is asked."""

    __tablename__ = "recall_log"

    id = Column(String, primary_key=True, default=lambda: generate_id("rl_"))
    user_id = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=False)
    kind = Column(String, nullable=False)  # "search" | "read"
    query = Column(String, nullable=True)  # what a search asked; None for a read
    hits = Column(Integer, nullable=False)
    took_ms = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
