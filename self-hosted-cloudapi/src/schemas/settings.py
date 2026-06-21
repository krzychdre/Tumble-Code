"""Organization and user settings schemas."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, Dict, List, Any


class OrganizationCloudSettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    record_task_messages: Optional[bool] = None
    enable_task_sharing: Optional[bool] = None
    allow_public_task_sharing: Optional[bool] = None
    task_share_expiration_days: Optional[int] = None
    allow_members_view_all_tasks: Optional[bool] = None
    workspace_task_visibility: Optional[str] = None
    llm_enhanced_features_enabled: Optional[bool] = None


class OrganizationAllowList(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    allow_all: bool = True
    providers: Dict[str, Any] = {}


class OrganizationSettingsResponse(BaseModel):
    """Matches the client OrganizationSettings schema."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    version: int = 0
    cloud_settings: Optional[OrganizationCloudSettings] = None
    default_settings: Dict[str, Any] = {}
    allow_list: OrganizationAllowList = OrganizationAllowList()
    features: Optional[Dict[str, Any]] = None
    hidden_mcps: Optional[List[str]] = None
    hide_marketplace_mcps: Optional[bool] = None
    mcps: Optional[List[Any]] = None
    provider_profiles: Optional[Dict[str, Any]] = None


class UserFeatures(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    pass  # Empty object for now


class UserSettingsConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    task_sync_enabled: Optional[bool] = None
    llm_enhanced_features_enabled: Optional[bool] = None


class UserSettingsData(BaseModel):
    """Matches the client UserSettingsData schema."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    features: UserFeatures = UserFeatures()
    settings: UserSettingsConfig = UserSettingsConfig()
    version: int = 0


class ExtensionSettingsResponse(BaseModel):
    """Response for GET /api/extension-settings."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, serialize_by_alias=True)

    organization: OrganizationSettingsResponse
    user: UserSettingsData


class UpdateUserSettingsRequest(BaseModel):
    """Request for PATCH /api/user-settings."""
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    settings: UserSettingsConfig
    version: Optional[int] = None
