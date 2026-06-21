"""OpenAI provider implementation."""

from typing import Any, Optional, AsyncIterator
import httpx

from src.proxy.providers.base import BaseProvider
from config.settings import settings


class OpenAIProvider(BaseProvider):
    """OpenAI API provider."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.openai_api_key
        self.base_url = "https://api.openai.com/v1"

    async def chat_completions(
        self,
        model: str,
        messages: list,
        stream: bool = True,
        **kwargs,
    ) -> Any:
        """Send a chat completion request to OpenAI.

        For streaming requests, returns an async generator of bytes.
        For non-streaming requests, returns the parsed JSON dict.
        """
        # Strip provider prefix from model name
        clean_model = model.split("/", 1)[-1] if "/" in model else model

        body = {
            "model": clean_model,
            "messages": messages,
            "stream": stream,
            **kwargs,
        }

        if stream:
            # For streaming, use an async generator to manage client lifecycle
            async def _stream():
                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        yield chunk
            return _stream()
        else:
            # For non-streaming, return parsed JSON
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                    timeout=120.0,
                )
                response.raise_for_status()
                return response.json()

    async def list_models(self) -> list:
        """List available models from OpenAI."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json().get("data", [])

    async def image_generations(
        self,
        model: str,
        prompt: str,
        **kwargs,
    ) -> Any:
        """Generate an image using OpenAI."""
        async with httpx.AsyncClient() as client:
            clean_model = model.split("/", 1)[-1] if "/" in model else model

            body = {
                "model": clean_model,
                "prompt": prompt,
                **kwargs,
            }

            response = await client.post(
                f"{self.base_url}/images/generations",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=120.0,
            )
            response.raise_for_status()
            return response.json()
