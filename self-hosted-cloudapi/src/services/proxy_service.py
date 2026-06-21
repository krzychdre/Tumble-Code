"""LLM proxy service."""

from typing import Optional, AsyncIterator, Any

from src.proxy.router import get_provider_for_model, get_api_key_for_provider
from src.proxy.providers.openai import OpenAIProvider
from src.proxy.providers.anthropic import AnthropicProvider
from src.proxy.providers.custom import CustomProvider
from src.schemas.models import RooModelsResponse, RooModel, RooPricing


# Default model catalog for self-hosted deployment
DEFAULT_MODELS = [
    RooModel(
        id="openai/gpt-4o",
        object="model",
        created=1700000000,
        owned_by="openai",
        name="GPT-4o",
        description="High-performance model from OpenAI",
        context_window=128000,
        max_tokens=16384,
        type="language",
        tags=["vision", "reasoning"],
        pricing=RooPricing(input="0.000005", output="0.000015"),
    ),
    RooModel(
        id="anthropic/claude-sonnet-4-20250514",
        object="model",
        created=1700000000,
        owned_by="anthropic",
        name="Claude Sonnet 4",
        description="High-performance model from Anthropic",
        context_window=200000,
        max_tokens=8192,
        type="language",
        tags=["vision", "reasoning"],
        pricing=RooPricing(input="0.000003", output="0.000015"),
    ),
]


async def get_models_list(org_id: Optional[str] = None) -> RooModelsResponse:
    """Get the list of available models.

    In a full implementation, this would be configurable per organization.
    For now, returns the default model catalog.
    """
    return RooModelsResponse(data=DEFAULT_MODELS)


def get_provider(provider_name: str, base_url: Optional[str] = None):
    """Get a provider instance by name."""
    api_key = get_api_key_for_provider(provider_name)

    if provider_name == "openai":
        return OpenAIProvider(api_key=api_key)
    elif provider_name == "anthropic":
        return AnthropicProvider(api_key=api_key)
    elif provider_name == "custom":
        if not base_url:
            base_url = "http://localhost:8000/v1"
        return CustomProvider(base_url=base_url, api_key=api_key)
    else:
        # Default to OpenAI-compatible
        return OpenAIProvider(api_key=api_key)


async def proxy_chat_completions(
    body: dict,
    org_id: Optional[str] = None,
    stream: bool = True,
) -> Any:
    """Proxy a chat completion request to the upstream provider."""
    model_id = body.get("model", "")
    provider_name = get_provider_for_model(model_id)

    try:
        provider = get_provider(provider_name)
        response = await provider.chat_completions(
            model=model_id,
            messages=body.get("messages", []),
            stream=stream,
            **{k: v for k, v in body.items() if k not in ("model", "messages", "stream")},
        )
        return response
    except NotImplementedError:
        from src.proxy.openai_compat import build_error_response
        return build_error_response(501, f"Provider {provider_name} not yet implemented")
    except Exception as e:
        from src.proxy.openai_compat import build_error_response
        return build_error_response(502, f"Upstream error: {str(e)}")


async def proxy_image_generations(
    body: dict,
    org_id: Optional[str] = None,
) -> Any:
    """Proxy an image generation request to the upstream provider."""
    model_id = body.get("model", "")
    provider_name = get_provider_for_model(model_id)

    try:
        provider = get_provider(provider_name)
        response = await provider.image_generations(
            model=model_id,
            prompt=body.get("prompt", ""),
            **{k: v for k, v in body.items() if k not in ("model", "prompt")},
        )
        return response
    except NotImplementedError:
        from src.proxy.openai_compat import build_error_response
        return build_error_response(501, f"Provider {provider_name} does not support image generation")
    except Exception as e:
        from src.proxy.openai_compat import build_error_response
        return build_error_response(502, f"Upstream error: {str(e)}")
