"""Telemetry event schemas."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, Dict, Any


class TelemetryEventRequest(BaseModel):
    """Request for POST /api/events."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    type: str
    properties: Optional[Dict[str, Any]] = None
