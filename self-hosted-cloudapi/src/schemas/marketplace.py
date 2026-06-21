"""Marketplace item schemas."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, List, Any


class ModeMarketplaceItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: str
    name: str
    description: Optional[str] = None
    type: str = "mode"
    content: str


class McpMarketplaceItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: str
    name: str
    description: Optional[str] = None
    type: str = "mcp"
    url: str


class MarketplaceModesResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    modes: List[ModeMarketplaceItem]


class MarketplaceMcpsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    mcps: List[McpMarketplaceItem]
