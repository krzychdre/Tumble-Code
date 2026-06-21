"""Organization and Membership models."""

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from src.models.base import Base, TimestampMixin, generate_id


class Organization(Base, TimestampMixin):
    """Organization model."""
    __tablename__ = "organizations"

    id = Column(String, primary_key=True, default=lambda: generate_id("org_"))
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=True)
    image_url = Column(String, nullable=True)
    has_image = Column(Boolean, default=False)

    memberships = relationship("Membership", back_populates="organization", cascade="all, delete-orphan")
    org_settings = relationship("OrganizationSettings", back_populates="organization", uselist=False, cascade="all, delete-orphan")
    provider_config = relationship("ProviderConfig", back_populates="organization", uselist=False, cascade="all, delete-orphan")


class Membership(Base, TimestampMixin):
    """Organization membership model."""
    __tablename__ = "memberships"

    id = Column(String, primary_key=True, default=lambda: generate_id("mem_"))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String, default="org:member")
    permissions = Column(Text, default="[]")

    user = relationship("User", back_populates="memberships")
    organization = relationship("Organization", back_populates="memberships")
