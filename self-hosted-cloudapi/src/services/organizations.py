"""Organizations and their members, copied from Authentik groups.

Authentik is where organizations are managed; the cloud keeps a copy so that
tasks, projects and the session token can refer to an organization by id.

* A group with the attribute ``tumble_organization: "<slug>"`` is an
  organization: ``Organization.slug`` is that value, ``Organization.name`` the
  group's name. Its direct members are ``org:member``.
* A group with ``tumble_organization_admins: "<slug>"`` lists the
  organization's admins (``org:admin``), who are members even when they are
  not in the first group.
* People are matched by Authentik's user ``uid``, which is the OIDC ``sub``
  the cloud stores as ``users.authentik_id``. Someone who never signed in to
  the cloud has no user row and is skipped until their first sign-in.

The sync runs at startup, every ``SYNC_SECONDS`` and after every sign-in. An
organization that no longer has a group keeps its row (tasks and projects
point at it) and loses its members.

The role strings are the ones the Clerk-compatible membership endpoint answers
with.
"""

import asyncio
import logging
from collections import defaultdict
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.auth.authentik import fetch_groups
from src.database import async_session_factory
from src.models.organization import Membership, Organization
from src.models.user import User

logger = logging.getLogger(__name__)

ROLE_ADMIN = "org:admin"
ROLE_MEMBER = "org:member"

ORGANIZATION_ATTRIBUTE = "tumble_organization"
ADMINS_ATTRIBUTE = "tumble_organization_admins"

SYNC_SECONDS = 300

# The background loop and a sign-in both sync; one at a time, so two of them
# never insert the same organization or membership.
_sync_lock = asyncio.Lock()


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


async def sync_organizations(db: AsyncSession) -> None:
    """Fetch Authentik's groups and reconcile, committing ``db``.

    When Authentik cannot be read, the memberships stay as they are.
    """
    try:
        groups = await fetch_groups()
    except (httpx.HTTPError, ValueError) as error:
        logger.warning(
            "[organizations] could not read Authentik's groups, memberships unchanged "
            "(check AUTHENTIK_API_TOKEN): %r",
            error,
        )
        return
    async with _sync_lock:
        await reconcile_organizations(db, groups)
        await db.commit()


async def reconcile_organizations(
    db: AsyncSession, groups: list[dict[str, Any]]
) -> None:
    """Make organizations and memberships match Authentik's ``groups``."""
    names: dict[str, str] = {}
    members: dict[str, set[str]] = defaultdict(set)
    admins: dict[str, set[str]] = defaultdict(set)
    uids: set[str] = set()
    for group in groups:
        active = {user["uid"] for user in group["users_obj"] if user["is_active"]}
        uids |= active
        slug = group["attributes"].get(ORGANIZATION_ATTRIBUTE)
        if slug:
            names[slug] = group["name"]
            members[slug] |= active
        admin_slug = group["attributes"].get(ADMINS_ATTRIBUTE)
        if admin_slug:
            admins[admin_slug] |= active

    rows = await db.execute(
        select(User.authentik_id, User.id).where(User.authentik_id.in_(uids))
    )
    user_ids = dict(rows.all())

    organizations = list((await db.scalars(select(Organization))).all())
    by_slug = {o.slug: o for o in organizations if o.slug}
    for slug, name in names.items():
        if slug in by_slug:
            by_slug[slug].name = name
        else:
            organization = Organization(slug=slug, name=name)
            db.add(organization)
            organizations.append(organization)
    await db.flush()

    current: dict[str, dict[str, Membership]] = defaultdict(dict)
    for membership in (await db.scalars(select(Membership))).all():
        current[membership.organization_id][membership.user_id] = membership

    for organization in organizations:
        wanted: dict[str, str] = {}
        if organization.slug in names:
            for uid in members[organization.slug]:
                wanted[uid] = ROLE_MEMBER
            for uid in admins[organization.slug]:
                wanted[uid] = ROLE_ADMIN
        roles = {user_ids[uid]: role for uid, role in wanted.items() if uid in user_ids}

        existing = current[organization.id]
        for user_id, membership in existing.items():
            if user_id not in roles:
                await db.delete(membership)
            else:
                membership.role = roles[user_id]
        for user_id, role in roles.items():
            if user_id not in existing:
                db.add(
                    Membership(
                        user_id=user_id, organization_id=organization.id, role=role
                    )
                )
    await db.flush()


async def run_organization_sync_loop() -> None:
    """Sync now and then every ``SYNC_SECONDS``, forever; a failure is logged
    and the next tick tries again (as in services/retention_scheduler)."""
    while True:
        try:
            async with async_session_factory() as db:
                await sync_organizations(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[organizations] sync failed; will retry next tick")
        await asyncio.sleep(SYNC_SECONDS)
