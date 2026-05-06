"""Task, TaskMessage, and TaskShare models."""

import uuid
from sqlalchemy import Column, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from src.models.base import Base, TimestampMixin, generate_id


class Task(Base, TimestampMixin):
    """Task model for tracking shared tasks."""
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)

    messages = relationship("TaskMessage", back_populates="task", cascade="all, delete-orphan")
    shares = relationship("TaskShare", back_populates="task", cascade="all, delete-orphan")


class TaskMessage(Base):
    """Task message model for backfill."""
    __tablename__ = "task_messages"

    id = Column(String, primary_key=True, default=lambda: generate_id("msg_"))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    message_data = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    task = relationship("Task", back_populates="messages")


class TaskShare(Base):
    """Task share model."""
    __tablename__ = "task_shares"

    id = Column(String, primary_key=True, default=lambda: generate_id("sh_"))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    visibility = Column(String, default="organization")
    share_url = Column(String, nullable=True)
    manage_url = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    task = relationship("Task", back_populates="shares")
