"""Extension API router.

Implements endpoints under /api/extension:
- POST /api/extension/share
- GET /api/extension/bridge/config
- GET /api/extension/credit-balance
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.schemas.share import ShareTaskRequest, ShareResponse
from src.services.share_service import share_task
from src.services.bridge_service import get_bridge_config
from config.settings import settings

router = APIRouter(prefix="/api/extension", tags=["extension"])


@router.post("/share")
async def share_task_endpoint(
    body: ShareTaskRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ShareResponse:
    """Share a task."""
    result = await share_task(
        db=db,
        task_id=body.task_id,
        user_id=current_user["user_id"],
        visibility=body.visibility,
    )
    return result


@router.get("/bridge/config")
async def bridge_config_endpoint(
    current_user: dict = Depends(get_current_user),
):
    """Get bridge/websocket config."""
    if not settings.bridge_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bridge is not enabled",
        )

    return await get_bridge_config(
        user_id=current_user["user_id"],
        org_id=current_user.get("org_id"),
    )


@router.get("/credit-balance")
async def credit_balance_endpoint(
    current_user: dict = Depends(get_current_user),
):
    """Get credit balance."""
    if not settings.credit_system_enabled:
        # Return a default balance when credit system is not enabled
        return {"balance": 0}

    # TODO: Implement actual credit tracking
    return {"balance": 0}
