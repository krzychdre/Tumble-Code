"""User and organization service."""

from typing import Optional, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.user import User
from src.models.organization import Organization, Membership
from src.models.settings import OrganizationSettings, UserSettings


async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    """Get a user by their ID."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_memberships(
    db: AsyncSession, user_id: str
) -> List[Membership]:
    """Get all organization memberships for a user."""
    result = await db.execute(
        select(Membership)
        .where(Membership.user_id == user_id)
        .options(selectinload(Membership.organization))
    )
    return list(result.scalars().all())


async def get_or_create_org_settings(
    db: AsyncSession, org_id: str
) -> OrganizationSettings:
    """Get or create organization settings."""
    result = await db.execute(
        select(OrganizationSettings).where(OrganizationSettings.organization_id == org_id)
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = OrganizationSettings(organization_id=org_id)
        db.add(settings)
        await db.flush()
    return settings


async def get_or_create_user_settings(
    db: AsyncSession, user_id: str
) -> UserSettings:
    """Get or create user settings."""
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = UserSettings(user_id=user_id)
        db.add(settings)
        await db.flush()
    return settings
