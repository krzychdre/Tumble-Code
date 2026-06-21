"""Base model with common mixins."""

from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, func
import uuid

from src.database import Base  # noqa: F401 – re-export for model imports


class TimestampMixin:
    """Mixin that adds created_at and updated_at timestamps."""
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def generate_id(prefix: str) -> str:
    """Generate a prefixed UUID-based ID (e.g., user_xxxxxxxx)."""
    return f"{prefix}{uuid.uuid4().hex[:25]}"
