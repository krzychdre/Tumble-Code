"""Base provider interface."""

from abc import ABC, abstractmethod
from typing import Any, Optional, AsyncIterator, Union


class BaseProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def chat_completions(
        self,
        model: str,
        messages: list,
        stream: bool = True,
        **kwargs,
    ) -> Union[AsyncIterator[bytes], dict]:
        """Send a chat completion request.

        When stream=True, returns an async iterator of bytes (SSE chunks).
        When stream=False, returns a parsed JSON dict (OpenAI-compatible format).
        """
        pass

    @abstractmethod
    async def list_models(self) -> list:
        """List available models."""
        pass

    @abstractmethod
    async def image_generations(
        self,
        model: str,
        prompt: str,
        **kwargs,
    ) -> Any:
        """Generate an image."""
        pass
