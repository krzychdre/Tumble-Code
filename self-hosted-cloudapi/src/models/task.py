"""Task, TaskMessage, and TaskShare models."""

import uuid
from sqlalchemy import Column, String, Text, ForeignKey, DateTime, BigInteger, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from src.models.base import Base, TimestampMixin, generate_id


class Task(Base, TimestampMixin):
    """Task model for tracking shared tasks."""
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    # Absolute path of the VS Code workspace folder (worktree root) the task was
    # attached to, captured from the bridge's extension:register `workspacePath`
    # or the share/backfill payload. Nullable: legacy rows and tasks created
    # while the bridge was offline (and the client sent nothing) have no value.
    workspace_path = Column(String, nullable=True)

    messages = relationship("TaskMessage", back_populates="task", cascade="all, delete-orphan")
    shares = relationship("TaskShare", back_populates="task", cascade="all, delete-orphan")


class TaskMessage(Base):
    """Task message model for backfill."""
    __tablename__ = "task_messages"

    id = Column(String, primary_key=True, default=lambda: generate_id("msg_"))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    message_data = Column(Text, nullable=False)
    # ClineMessage.ts of the stored message. Lets the live bridge upsert a
    # streaming message in place (created → partial updates → final) instead of
    # appending duplicate rows. Nullable for legacy/backfilled rows.
    message_ts = Column(BigInteger, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # The bridge upserts a streaming message in place via ON CONFLICT on this
    # pair. NULL message_ts stays distinct, so legacy/backfilled rows still
    # append. See migration d4e5f6a7b8c9.
    __table_args__ = (
        UniqueConstraint("task_id", "message_ts", name="uq_task_messages_task_ts"),
    )

    task = relationship("Task", back_populates="messages")


class TaskShare(Base):
    """Task share model."""
    __tablename__ = "task_shares"

    id = Column(String, primary_key=True, default=lambda: generate_id("sh_"))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    visibility = Column(String, default="organization")
    share_url = Column(String, nullable=True)
    manage_url = Column(String, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    task = relationship("Task", back_populates="shares")
