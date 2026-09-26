"""TelemetryEvent model."""

from sqlalchemy import Column, String, Text, ForeignKey, DateTime, Index
from datetime import datetime, timezone

from src.models.base import Base, generate_id


class TelemetryEvent(Base):
    """Telemetry event model."""
    __tablename__ = "telemetry_events"
    __table_args__ = (
        # The metrics page (services/metrics_service) reads one user's events of
        # one type over a created_at range, ordered by created_at. The
        # single-column indexes can only serve one of the three conditions;
        # this one serves all of them and the ORDER BY. Added by migration
        # a3b4c5d6e7f8.
        Index("ix_telemetry_events_user_type_created", "user_id", "event_type", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: generate_id("evt_"))
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    # Lifted out of `properties` at ingest so the task a completion belongs to is
    # an indexed lookup instead of a JSON scan over the whole event corpus. The
    # blob stays authoritative — this is a key, not a second source of truth.
    # Not a FK: telemetry names tasks that may never be stored as rows.
    task_id = Column(String, nullable=True, index=True)
    properties = Column(Text, default="{}")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
