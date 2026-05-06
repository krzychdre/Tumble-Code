"""OAuth state storage for Authentik PKCE flow."""

from sqlalchemy import Column, String, DateTime
from datetime import datetime, timezone

from src.models.base import Base


class AuthentikStateStore(Base):
    """Stores OAuth state parameters and PKCE code verifiers during auth flow."""
    __tablename__ = "authentik_state_store"

    state = Column(String, primary_key=True)
    auth_redirect = Column(String, nullable=False)
    code_verifier = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime, nullable=False)
