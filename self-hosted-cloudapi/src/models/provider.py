"""Provider configuration model for LLM proxy."""

from sqlalchemy import Column, String, Text, ForeignKey
from sqlalchemy.orm import relationship

from src.models.base import Base, TimestampMixin, generate_id


class ProviderConfig(Base, TimestampMixin):
    """Provider configuration for LLM proxy routing."""
    __tablename__ = "provider_configs"

    id = Column(String, primary_key=True, default=lambda: generate_id("pc_"))
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=True)
    providers = Column(Text, nullable=False, default="[]")
    model_overrides = Column(Text, default="{}")

    organization = relationship("Organization", back_populates="provider_config")
