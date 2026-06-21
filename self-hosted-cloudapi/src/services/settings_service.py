"""Settings service for extension-settings and user-settings endpoints."""

import hashlib
import json
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings as app_settings
from src.services.user_service import get_or_create_org_settings, get_or_create_user_settings
from src.schemas.settings import (
    OrganizationSettingsResponse,
    OrganizationCloudSettings,
    OrganizationAllowList,
    UserSettingsData,
    UserFeatures,
    UserSettingsConfig,
    ExtensionSettingsResponse,
)


def _content_version(payload: dict) -> int:
    """A stable, content-derived settings version (32-bit int).

    The extension caches org settings and only replaces them when the `version`
    field changes (CloudSettingsService.fetchSettings). A constant version means
    a client that cached the old org-less settings (e.g. cloudSettings=null from
    before task sharing was advertised) never picks up the new values. Deriving
    the version from the content guarantees any change to the advertised cloud
    settings bumps the version, so the client refreshes on its next fetch.
    """
    blob = json.dumps(payload, sort_keys=True).encode()
    return int.from_bytes(hashlib.sha256(blob).digest()[:4], "big")


async def get_extension_settings(
    db: AsyncSession,
    user_id: str,
    org_id: Optional[str],
) -> ExtensionSettingsResponse:
    """Get combined org + user settings for the /api/extension-settings endpoint."""
    # Organization settings
    #
    # With no organization configured (self-hosted single-tenant), there are no
    # org-level cloud settings. The extension gates its Share button on
    # `organization.cloudSettings.enableTaskSharing`, so without this the button
    # stays disabled ("sharingDisabledByOrganization"). Advertise task sharing as
    # enabled at the org-less level, controlled by ENABLE_TASK_SHARING. The
    # version is content-derived so already-logged-in clients pick up the change.
    org_cloud_settings = OrganizationCloudSettings(
        enable_task_sharing=app_settings.enable_task_sharing,
        allow_public_task_sharing=app_settings.allow_public_task_sharing,
    )
    org_settings_response = OrganizationSettingsResponse(
        version=_content_version(org_cloud_settings.model_dump(by_alias=True)),
        cloud_settings=org_cloud_settings,
    )
    if org_id:
        org_settings = await get_or_create_org_settings(db, org_id)
        allow_list = json.loads(org_settings.allow_list) if org_settings.allow_list else {"allowAll": True, "providers": {}}
        org_settings_response = OrganizationSettingsResponse(
            version=org_settings.version,
            cloud_settings=OrganizationCloudSettings(
                record_task_messages=org_settings.record_task_messages,
                enable_task_sharing=org_settings.enable_task_sharing,
                allow_public_task_sharing=org_settings.allow_public_task_sharing,
                task_share_expiration_days=org_settings.task_share_expiration_days,
                allow_members_view_all_tasks=org_settings.allow_members_view_all_tasks,
                workspace_task_visibility=org_settings.workspace_task_visibility,
                llm_enhanced_features_enabled=org_settings.llm_enhanced_features_enabled,
            ) if org_settings else None,
            default_settings=json.loads(org_settings.default_settings) if org_settings.default_settings else {},
            allow_list=OrganizationAllowList(**allow_list),
            features=json.loads(org_settings.features) if org_settings.features else None,
            hidden_mcps=json.loads(org_settings.hidden_mcps) if org_settings.hidden_mcps else None,
            hide_marketplace_mcps=org_settings.hide_marketplace_mcps,
            mcps=json.loads(org_settings.mcps) if org_settings.mcps else None,
            provider_profiles=json.loads(org_settings.provider_profiles) if org_settings.provider_profiles else None,
        )

    # User settings
    user_settings_data = UserSettingsData()
    user_settings = await get_or_create_user_settings(db, user_id)
    if user_settings:
        settings_config = json.loads(user_settings.settings) if user_settings.settings else {}
        user_settings_data = UserSettingsData(
            features=UserFeatures(),
            settings=UserSettingsConfig(**settings_config),
            version=user_settings.version,
        )

    return ExtensionSettingsResponse(
        organization=org_settings_response,
        user=user_settings_data,
    )


async def update_user_settings(
    db: AsyncSession,
    user_id: str,
    settings: UserSettingsConfig,
    version: Optional[int] = None,
) -> UserSettingsData:
    """Update user settings with optimistic locking."""
    user_settings = await get_or_create_user_settings(db, user_id)

    # Optimistic locking check
    if version is not None and user_settings.version != version:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Version conflict")

    user_settings.settings = json.dumps(settings.model_dump(by_alias=False))
    user_settings.version += 1
    await db.flush()

    return UserSettingsData(
        features=UserFeatures(),
        settings=settings,
        version=user_settings.version,
    )
