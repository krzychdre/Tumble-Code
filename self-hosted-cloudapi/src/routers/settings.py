"""Settings API router.

Implements endpoints:
- GET /api/extension-settings
- PATCH /api/user-settings
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.schemas.settings import (
    ExtensionSettingsResponse,
    UpdateUserSettingsRequest,
    UserSettingsData,
)
from src.services.settings_service import get_extension_settings, update_user_settings

router = APIRouter(prefix="/api", tags=["settings"])


# NOTE: response_model_exclude_none is REQUIRED here. The client parses this
# response with Zod schemas (packages/types cloud.ts) whose optional fields use
# `.optional()` — which accepts `undefined` but REJECTS `null`. Pydantic would
# otherwise serialize unset Optional fields as JSON `null`, the client parse would
# fail, CloudSettingsService never caches the settings, and `canShareTask()` returns
# false — silently disabling the Share button. Omitting nulls keeps the contract.
@router.get("/extension-settings", response_model_exclude_none=True)
async def extension_settings_endpoint(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExtensionSettingsResponse:
    """Fetch org + user settings."""
    return await get_extension_settings(
        db=db,
        user_id=current_user["user_id"],
        org_id=current_user.get("org_id"),
    )


# Same null-vs-undefined contract as /extension-settings: the client parses this
# with the strict `.optional()` userSettingsDataSchema, so unset fields must be
# omitted rather than serialized as null.
@router.patch("/user-settings", response_model_exclude_none=True)
async def update_user_settings_endpoint(
    body: UpdateUserSettingsRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserSettingsData:
    """Update user settings with optimistic locking."""
    return await update_user_settings(
        db=db,
        user_id=current_user["user_id"],
        settings=body.settings,
        version=body.version,
    )
