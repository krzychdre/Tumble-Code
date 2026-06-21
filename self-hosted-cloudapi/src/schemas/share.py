"""Share response schema."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional


class ShareTaskRequest(BaseModel):
    """Request for POST /api/extension/share."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    task_id: str
    visibility: str = "organization"


class ShareResponse(BaseModel):
    """Matches the client ShareResponse schema."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    success: bool
    share_url: Optional[str] = None
    error: Optional[str] = None
    is_new_share: Optional[bool] = None
    manage_url: Optional[str] = None
