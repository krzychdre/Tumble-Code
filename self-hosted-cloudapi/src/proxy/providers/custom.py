"""Custom/OpenAI-compatible provider implementation."""

from typing import Any, Optional, AsyncIterator
import httpx

from src.proxy.providers.base import BaseProvider


class CustomProvider(BaseProvider):
    """Custom OpenAI-compatible endpoint provider."""

    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def chat_completions(
        self,
        model: str,
        messages: list,
        stream: bool = True,
        **kwargs,
    ) -> Any:
        """Send a chat completion request to a custom OpenAI-compatible endpoint.

        For streaming requests, returns an async iterator of bytes.
        For non-streaming requests, returns the parsed JSON dict.
        """
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        body = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs,
        }

        if stream:
            async def _stream():
                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
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
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=body,
                    timeout=120.0,
                )
                response.raise_for_status()
                return response.json()

    async def list_models(self) -> list:
        """List available models from custom endpoint."""
        async with httpx.AsyncClient() as client:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"

            response = await client.get(
                f"{self.base_url}/models",
                headers=headers,
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
        """Generate an image using custom endpoint."""
        async with httpx.AsyncClient() as client:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"

            body = {
                "model": model,
                "prompt": prompt,
                **kwargs,
            }

            response = await client.post(
                f"{self.base_url}/images/generations",
                headers=headers,
                json=body,
                timeout=120.0,
            )
            response.raise_for_status()
            return response.json()
