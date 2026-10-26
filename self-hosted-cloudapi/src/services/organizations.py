"""Organizations: creating one and managing its members (/app/organizations).

The rules, enforced here and nowhere else:

* any signed-in user may create an organization and becomes its admin;
* only an admin adds members, changes roles and removes other members; any
  member may leave;
* a member is added by the e-mail of a user who has signed in at least once
  (Authentik decides who may sign in, so there is no invitation of strangers);
* an organization always keeps at least one admin.

The role strings are the ones the Clerk-compatible membership endpoint already
answers with (``org:admin``, ``org:member``).
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.organization import Membership, Organization
from src.models.user import User

ROLE_ADMIN = "org:admin"
ROLE_MEMBER = "org:member"
ROLES = (ROLE_ADMIN, ROLE_MEMBER)

NAME_MAX = 100


class OrganizationError(Exception):
    """A refused change. ``code`` keys the message the page shows."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


async def create_organization(
    db: AsyncSession, user_id: str, name: str
) -> Organization:
    name = name.strip()
    if not name or len(name) > NAME_MAX:
        raise OrganizationError("bad_name")
    organization = Organization(name=name)
    db.add(organization)
    await db.flush()
    db.add(
        Membership(user_id=user_id, organization_id=organization.id, role=ROLE_ADMIN)
    )
    await db.flush()
    return organization


async def membership_of(
    db: AsyncSession, org_id: str, user_id: str
) -> Membership | None:
    """The user's membership in the organization, with the organization loaded."""
    return await db.scalar(
        select(Membership)
        .where(Membership.organization_id == org_id, Membership.user_id == user_id)
        .options(selectinload(Membership.organization))
    )


async def members_of(db: AsyncSession, org_id: str) -> list[Membership]:
    """Every membership of the organization with its user, admins first."""
    result = await db.execute(
        select(Membership)
        .where(Membership.organization_id == org_id)
        .options(selectinload(Membership.user))
        .order_by(Membership.role != ROLE_ADMIN, Membership.created_at)
    )
    return list(result.scalars().all())


async def member_counts(db: AsyncSession, org_ids: list[str]) -> dict[str, int]:
    result = await db.execute(
        select(Membership.organization_id, func.count())
        .where(Membership.organization_id.in_(org_ids))
        .group_by(Membership.organization_id)
    )
    return dict(result.all())


async def add_member(
    db: AsyncSession, org_id: str, email: str, role: str
) -> Membership:
    if role not in ROLES:
        raise OrganizationError("bad_role")
    users = (
        (
            await db.execute(
                select(User).where(func.lower(User.email) == email.strip().lower())
            )
        )
        .scalars()
        .all()
    )
    if not users:
        raise OrganizationError("unknown_email")
    if len(users) > 1:
        raise OrganizationError("ambiguous_email")
    [user] = users
    if await membership_of(db, org_id, user.id) is not None:
        raise OrganizationError("already_member")
    membership = Membership(user_id=user.id, organization_id=org_id, role=role)
    db.add(membership)
    await db.flush()
    return membership


async def set_role(db: AsyncSession, org_id: str, user_id: str, role: str) -> None:
    if role not in ROLES:
        raise OrganizationError("bad_role")
    membership = await _existing(db, org_id, user_id)
    if membership.role == ROLE_ADMIN and role != ROLE_ADMIN:
        await _keep_an_admin(db, org_id)
    membership.role = role
    await db.flush()


async def remove_member(db: AsyncSession, org_id: str, user_id: str) -> None:
    """Remove a member; the same call is how a member leaves."""
    membership = await _existing(db, org_id, user_id)
    if membership.role == ROLE_ADMIN:
        await _keep_an_admin(db, org_id)
    await db.delete(membership)
    await db.flush()


async def _existing(db: AsyncSession, org_id: str, user_id: str) -> Membership:
    membership = await membership_of(db, org_id, user_id)
    if membership is None:
        raise OrganizationError("not_member")
    return membership


async def _keep_an_admin(db: AsyncSession, org_id: str) -> None:
    """Refuse to take away an admin when it is the organization's last one."""
    admins = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.organization_id == org_id, Membership.role == ROLE_ADMIN)
    )
    if admins <= 1:
        raise OrganizationError("last_admin")
