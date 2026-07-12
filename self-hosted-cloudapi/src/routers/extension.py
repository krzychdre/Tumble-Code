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


# response_model_exclude_none is REQUIRED: the client parses this body with the
# Zod shareResponseSchema (packages/types/src/cloud.ts) whose optional fields use
# `.optional()`, which accepts `undefined` but REJECTS `null`. On the success path
# `error` (and any other unset Optional) would otherwise serialize as JSON `null`,
# the Zod parse in CloudAPI.shareTask would throw, and the extension would show
# "Failed to share task" even though the task persisted and the share row exists.
# Same contract as /api/extension-settings (see routers/settings.py).
@router.post("/share", response_model_exclude_none=True)
async def share_task_endpoint(
    body: ShareTaskRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ShareResponse:
    """Share a task.

    Returns HTTP 404 when the task does not exist yet. The extension relies on
    this: on a 404 (TaskNotFoundError) it backfills the task messages via
    /api/events/backfill and retries this endpoint. Returning 200 with
    success=false would skip that backfill, so the task would never persist.
    """
    result = await share_task(
        db=db,
        task_id=body.task_id,
        user_id=current_user["user_id"],
        visibility=body.visibility,
    )
    if not result.success:
        err = (result.error or "").lower()
        if err == "task not found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found",
            )
        # Policy violations: the caller has already proven ownership (the
        # service only returns these after the ownership check passes), so a
        # 403 is explicit and non-leaking — no information about the task's
        # existence is revealed to a non-owner.
        if "disabled for this organization" in err:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=result.error,
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
