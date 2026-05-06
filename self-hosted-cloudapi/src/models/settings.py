"""Organization and User settings models."""

from sqlalchemy import Column, String, Integer, Boolean, Text, ForeignKey
from sqlalchemy.orm import relationship

from src.models.base import Base, TimestampMixin, generate_id


class OrganizationSettings(Base, TimestampMixin):
    """Organization settings model matching the client OrganizationSettings schema."""
    __tablename__ = "organization_settings"

    id = Column(String, primary_key=True, default=lambda: generate_id("os_"))
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False)
    version = Column(Integer, default=0)

    # Cloud settings
    record_task_messages = Column(Boolean, default=True)
    enable_task_sharing = Column(Boolean, default=True)
    allow_public_task_sharing = Column(Boolean, default=True)
    task_share_expiration_days = Column(Integer, default=30)
    allow_members_view_all_tasks = Column(Boolean, default=True)
    workspace_task_visibility = Column(String, default="all")
    llm_enhanced_features_enabled = Column(Boolean, default=False)

    # Default settings (JSON)
    default_settings = Column(Text, default="{}")

    # Allow list (JSON)
    allow_list = Column(Text, default='{"allowAll": true, "providers": {}}')

    # Features (JSON)
    features = Column(Text, default="{}")

    # MCPs and marketplace
    hidden_mcps = Column(Text, default="[]")
    hide_marketplace_mcps = Column(Boolean, default=False)
    mcps = Column(Text, default="[]")

    # Provider profiles (JSON)
    provider_profiles = Column(Text, default="{}")

    organization = relationship("Organization", back_populates="org_settings")


class UserSettings(Base, TimestampMixin):
    """User settings model matching the client UserSettingsData schema."""
    __tablename__ = "user_settings"

    id = Column(String, primary_key=True, default=lambda: generate_id("us_"))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    features = Column(Text, default="{}")
    settings = Column(Text, default="{}")
    version = Column(Integer, default=0)

    user = relationship("User", back_populates="user_settings")
