"""TelemetryEvent model."""

from sqlalchemy import Column, String, Text, ForeignKey, DateTime
from datetime import datetime, timezone

from src.models.base import Base, generate_id


class TelemetryEvent(Base):
    """Telemetry event model."""
    __tablename__ = "telemetry_events"

    id = Column(String, primary_key=True, default=lambda: generate_id("evt_"))
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    properties = Column(Text, default="{}")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
