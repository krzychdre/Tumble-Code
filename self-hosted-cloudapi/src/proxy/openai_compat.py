"""OpenAI-compatible response adapter."""

from typing import AsyncIterator, Any


async def adapt_streaming_response(
    response: Any,
) -> AsyncIterator[bytes]:
    """Adapt a streaming response from an upstream provider to SSE format."""
    async for chunk in response.aiter_bytes():
        yield chunk


def build_error_response(
    status_code: int,
    message: str,
    error_type: str = "server_error",
) -> dict:
    """Build an OpenAI-compatible error response."""
    return {
        "error": {
            "type": error_type,
            "message": message,
            "code": status_code,
        }
    }
