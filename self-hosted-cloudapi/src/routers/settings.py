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


@router.get("/extension-settings")
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


@router.patch("/user-settings")
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
