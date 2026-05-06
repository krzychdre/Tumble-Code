"""User info schema."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional


class CloudUserInfo(BaseModel):
    """Matches the client CloudUserInfo schema.

    NOTE: Currently unused but part of the API contract — reserved for future use.
    """
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    picture: Optional[str] = None
    organization_id: Optional[str] = None
    organization_name: Optional[str] = None
    organization_role: Optional[str] = None
    organization_image_url: Optional[str] = None
