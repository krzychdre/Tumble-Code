"""Anthropic provider implementation (OpenAI-compatible adapter)."""

from typing import Any, Optional, AsyncIterator, List, Dict
import httpx

from src.proxy.providers.base import BaseProvider
from config.settings import settings


def _convert_openai_messages_to_anthropic(messages: List[Dict]) -> Dict:
    """Convert OpenAI-format messages to Anthropic-format input.

    Converts the OpenAI messages array into Anthropic's `messages` field
    and extracts the `system` prompt if present.
    """
    system = None
    anthropic_messages = []

    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if role == "system":
            system = content
        elif role == "user":
            anthropic_messages.append({"role": "user", "content": content})
        elif role == "assistant":
            anthropic_messages.append({"role": "assistant", "content": content})
        elif role == "tool":
            # Map tool results as user messages for basic compatibility
            anthropic_messages.append({"role": "user", "content": content})

    result = {"messages": anthropic_messages}
    if system is not None:
        result["system"] = system
    return result


def _convert_anthropic_response_to_openai(anthropic_response: Dict, model: str) -> Dict:
    """Convert an Anthropic chat response to OpenAI-compatible format."""
    content = ""
    for block in anthropic_response.get("content", []):
        if block.get("type") == "text":
            content += block.get("text", "")

    return {
        "id": f"chatcmpl-{anthropic_response.get('id', 'unknown')}",
        "object": "chat.completion",
        "created": 0,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": anthropic_response.get("usage", {}).get("input_tokens", 0),
            "completion_tokens": anthropic_response.get("usage", {}).get("output_tokens", 0),
            "total_tokens": anthropic_response.get("usage", {}).get("input_tokens", 0)
            + anthropic_response.get("usage", {}).get("output_tokens", 0),
        },
    }


class AnthropicProvider(BaseProvider):
    """Anthropic API provider with OpenAI-compatible format conversion."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.anthropic_api_key
        self.base_url = "https://api.anthropic.com/v1"

    async def chat_completions(
        self,
        model: str,
        messages: list,
        stream: bool = True,
        **kwargs,
    ) -> Any:
        """Send a chat completion request to Anthropic, converting from OpenAI format.

        For streaming requests, returns an async iterator of bytes (SSE format).
        For non-streaming requests, returns the OpenAI-compatible parsed JSON dict.
        """
        # Strip provider prefix from model name
        clean_model = model.split("/", 1)[-1] if "/" in model else model

        # Convert OpenAI messages to Anthropic format
        converted = _convert_openai_messages_to_anthropic(messages)

        body = {
            "model": clean_model,
            "messages": converted["messages"],
            "max_tokens": kwargs.pop("max_tokens", kwargs.pop("max_tokens", 4096)),
            "stream": stream,
        }
        if "system" in converted:
            body["system"] = converted["system"]
        # Pass through supported kwargs
        for key in ("temperature", "top_p", "stop_sequences"):
            if key in kwargs:
                body[key] = kwargs[key]

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        if stream:
            async def _stream():
                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(
                        f"{self.base_url}/messages",
                        headers=headers,
                        json=body,
                    )
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        yield chunk
            return _stream()
        else:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/messages",
                    headers=headers,
                    json=body,
                    timeout=120.0,
                )
                response.raise_for_status()
                anthropic_response = response.json()
                return _convert_anthropic_response_to_openai(anthropic_response, model)

    async def list_models(self) -> list:
        """List available Anthropic models (static list)."""
        return [
            {"id": "anthropic/claude-sonnet-4-20250514", "object": "model", "created": 0, "owned_by": "anthropic"},
            {"id": "anthropic/claude-3-5-sonnet-20241022", "object": "model", "created": 0, "owned_by": "anthropic"},
            {"id": "anthropic/claude-3-5-haiku-20241022", "object": "model", "created": 0, "owned_by": "anthropic"},
        ]

    async def image_generations(
        self,
        model: str,
        prompt: str,
        **kwargs,
    ) -> Any:
        """Anthropic does not support image generation."""
        raise NotImplementedError("Anthropic does not support image generation")
