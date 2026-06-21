"""Provider routing logic for LLM proxy."""

from typing import Optional, Dict, Any
from config.settings import settings


def get_provider_for_model(model_id: str) -> str:
    """Determine the upstream provider based on model ID prefix."""
    if model_id.startswith("openai/"):
        return "openai"
    elif model_id.startswith("anthropic/"):
        return "anthropic"
    elif model_id.startswith("google/"):
        return "google"
    elif model_id.startswith("xai/"):
        return "xai"
    elif model_id.startswith("custom/"):
        return "custom"
    else:
        return settings.default_llm_provider


def get_api_key_for_provider(provider: str) -> Optional[str]:
    """Get the API key for a given provider."""
    key_map = {
        "openai": settings.openai_api_key,
        "anthropic": settings.anthropic_api_key,
        "google": settings.google_api_key,
        "xai": settings.xai_api_key,
    }
    return key_map.get(provider)
