"""LLM Proxy router.

Implements OpenAI-compatible proxy endpoints:
- GET /v1/models
- POST /v1/chat/completions
- POST /v1/images/generations
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse, JSONResponse
from typing import Optional

from src.dependencies import get_current_user_optional
from src.schemas.models import RooModelsResponse
from src.services.proxy_service import (
    get_models_list,
    proxy_chat_completions,
    proxy_image_generations,
)

router = APIRouter(prefix="/v1", tags=["proxy"])


@router.get("/models")
async def list_models(
    current_user: Optional[dict] = Depends(get_current_user_optional),
) -> RooModelsResponse:
    """List available models. Optional auth: Bearer sessionToken."""
    result = await get_models_list(org_id=current_user.get("org_id") if current_user else None)
    return result


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """OpenAI-compatible streaming chat completions. Auth: Bearer sessionToken."""
    body = await request.json()
    stream = body.get("stream", False)

    if stream:
        # proxy_chat_completions returns an async iterator of bytes when streaming
        stream_iter = await proxy_chat_completions(body, org_id=current_user.get("org_id") if current_user else None)
        return StreamingResponse(
            stream_iter,
            media_type="text/event-stream",
        )
    else:
        result = await proxy_chat_completions(body, org_id=current_user.get("org_id") if current_user else None, stream=False)
        return JSONResponse(content=result)


@router.post("/images/generations")
async def image_generations(
    request: Request,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Image generation endpoint. Auth: Bearer sessionToken."""
    body = await request.json()
    result = await proxy_image_generations(body, org_id=current_user.get("org_id") if current_user else None)
    return JSONResponse(content=result)
