"""User, Session, ClientToken, and Ticket models."""

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime, timedelta, timezone

from src.models.base import Base, TimestampMixin, generate_id


class User(Base, TimestampMixin):
    """User model compatible with Clerk user profiles."""
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: generate_id("user_"))
    authentik_id = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, nullable=False, index=True)
    first_name = Column(String, default="")
    last_name = Column(String, default="")
    image_url = Column(String, nullable=True)
    public_metadata = Column(Text, default="{}")

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    user_settings = relationship("UserSettings", back_populates="user", uselist=False, cascade="all, delete-orphan")
    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    """Session model representing an authenticated user session."""
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=lambda: generate_id("sess_"))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

    user = relationship("User", back_populates="sessions")
    client_tokens = relationship("ClientToken", back_populates="session", cascade="all, delete-orphan")


class ClientToken(Base):
    """Client token model for Clerk-compatible auth."""
    __tablename__ = "client_tokens"

    id = Column(String, primary_key=True, default=lambda: generate_id("ct_"))
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=True)

    session = relationship("Session", back_populates="client_tokens")


class Ticket(Base):
    """Short-lived, single-use ticket for Clerk sign-in flow."""
    __tablename__ = "tickets"

    code = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)

    session = relationship("Session")
