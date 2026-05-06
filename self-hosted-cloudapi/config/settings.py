"""Application settings loaded from environment variables."""

import json
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, HttpUrl, computed_field


class Settings(BaseSettings):
    """Roo Cloud API settings."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Core
    database_url: str = Field(..., description="PostgreSQL connection string")
    secret_key: str = Field(..., description="Secret key for signing tickets, etc.")
    api_base_url: str = Field(..., description="Public URL of this API")
    port: int = Field(8085, description="Port to run the API server on")

    # JWT
    jwt_algorithm: str = "HS256"
    jwt_private_key: Optional[str] = None
    jwt_public_key: Optional[str] = None
    jwt_secret: Optional[str] = None

    # Authentik OAuth
    authentik_base_url: str = Field(..., description="Authentik instance URL")
    authentik_app_slug: str = Field("stork-code", description="Authentik application slug for app-specific endpoints")
    authentik_client_id: str = Field(..., description="OAuth2 client ID")
    authentik_client_secret: Optional[str] = None
    authentik_redirect_uri: str = Field(..., description="OAuth2 redirect URI")

    # CORS - stored as raw string to avoid pydantic-settings v2 JSON-parsing issues
    # with List[str] env vars. Use cors_origins_list property to get the parsed list.
    cors_origins: str = Field(default="*", description="Allowed CORS origins (comma-separated or JSON array)")

    @computed_field(return_type=List[str])
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse cors_origins string into a list.

        Supports JSON array format (e.g. '["https://a.com","https://b.com"]')
        or comma-separated format (e.g. 'https://a.com,https://b.com' or '*').
        """
        try:
            return json.loads(self.cors_origins)
        except (json.JSONDecodeError, ValueError):
            return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    # LLM Proxy
    default_llm_provider: str = "openai"
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    xai_api_key: Optional[str] = None

    # Marketplace
    marketplace_source: str = "yaml"
    marketplace_yaml_dir: str = "./config/marketplace"

    # Optional features
    credit_system_enabled: bool = False
    bridge_enabled: bool = False
    telemetry_enabled: bool = True
    rate_limit_enabled: bool = True
    rate_limit_requests_per_minute: int = 60


settings = Settings()
