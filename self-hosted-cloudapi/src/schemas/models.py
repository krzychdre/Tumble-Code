"""LLM model listing schemas (OpenAI-compatible)."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, List, Dict, Any


class RooPricing(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    input: str
    output: str
    input_cache_read: Optional[str] = None
    input_cache_write: Optional[str] = None


class RooModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: str
    object: str = "model"
    created: int
    owned_by: str
    name: str
    description: str
    context_window: int
    max_tokens: int
    type: str = "language"
    tags: Optional[List[str]] = None
    pricing: RooPricing
    deprecated: Optional[bool] = None
    default_temperature: Optional[float] = None
    settings: Optional[Dict[str, Any]] = None
    versioned_settings: Optional[Dict[str, Dict[str, Any]]] = None


class RooModelsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    object: str = "list"
    data: List[RooModel]
