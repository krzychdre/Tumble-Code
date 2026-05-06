"""Clerk-compatible auth response schemas."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, List


class ClerkSignInResponse(BaseModel):
    """Response for POST /v1/client/sign_ins."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    class Response(BaseModel):
        model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)
        created_session_id: str
    response: Response


class ClerkSessionTokenResponse(BaseModel):
    """Response for POST /v1/client/sessions/{id}/tokens."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    jwt: str


class EmailAddress(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: str
    email_address: str


class ClerkMeResponse(BaseModel):
    """Response for GET /v1/me."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    class Response(BaseModel):
        model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)
        id: Optional[str] = None
        first_name: Optional[str] = None
        last_name: Optional[str] = None
        image_url: Optional[str] = None
        primary_email_address_id: Optional[str] = None
        email_addresses: Optional[List[EmailAddress]] = None
        public_metadata: Optional[dict] = None
    response: Response


class ClerkOrganization(BaseModel):
    """Pydantic schema for Clerk organization response (renamed to avoid collision with SQLAlchemy model)."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: str
    name: str
    slug: Optional[str] = None
    image_url: Optional[str] = None
    has_image: Optional[bool] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


class ClerkMembership(BaseModel):
    """Pydantic schema for Clerk membership response (renamed to avoid collision with SQLAlchemy model)."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    id: str
    role: str
    permissions: Optional[List[str]] = None
    organization: ClerkOrganization
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


class ClerkOrgMembershipsResponse(BaseModel):
    """Response for GET /v1/me/organization_memberships."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    response: List[ClerkMembership]


class AuthCallbackParams(BaseModel):
    """Parameters received from the VS Code URI callback."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    code: Optional[str] = None
    state: Optional[str] = None
    organization_id: Optional[str] = None
    provider_model: Optional[str] = None
