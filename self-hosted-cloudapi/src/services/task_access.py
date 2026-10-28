"""Who may open a shared task's page (``/shared/{task_id}``).

One policy, decided in one place:

* no share for the task: not found, for everybody;
* sharing switched off for the task (server or organization policy,
  src/services/share_policy.py): not found for everybody but the owner;
* a public share while public sharing is switched off: treated as an
  organization share;
* a public share: anybody, signed in or not;
* any other share viewed anonymously: sign in first;
* any other share viewed signed in: the task's owner, or a member of the
  organization the task belongs to. Everybody else gets not found, so a
  private conversation's existence is not disclosed.

The live bridge's ``task:join`` (src/realtime/sio.py) is a different, narrower
rule: only the task's owner may join, whatever the share says. The share page
mirrors it with ``is_owner``, which is what makes the page live.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.web_session import WebUser
from src.models.organization import Membership
from src.models.task import Task, TaskShare
from src.services.share_policy import sharing_policy


async def task_owner(db: AsyncSession, task_id: str) -> Optional[str]:
    """The id of the user who owns ``task_id``; None when there is no such task."""
    return await db.scalar(select(Task.user_id).where(Task.id == task_id))


class ShareVerdict(Enum):
    ALLOWED = "allowed"
    NOT_FOUND = "not_found"
    LOGIN_REQUIRED = "login_required"


@dataclass(frozen=True)
class ShareAccess:
    verdict: ShareVerdict
    share: Optional[TaskShare] = None
    task: Optional[Task] = None
    is_owner: bool = False


async def shared_view_access(
    db: AsyncSession, task_id: str, user: Optional[WebUser]
) -> ShareAccess:
    """Decide whether ``user`` (None when anonymous) may view the shared task."""
    result = await db.execute(select(TaskShare).where(TaskShare.task_id == task_id))
    share = result.scalar_one_or_none()

    if share is None:
        return ShareAccess(ShareVerdict.NOT_FOUND)

    # The share link is live (remote-controllable) only for the task's owner, so a
    # freshly-shared task is drivable straight from its share URL. Anonymous and
    # non-owner viewers stay strictly read-only. The backend independently enforces
    # the same owner-only rule (task:join DB ownership check + per-user command relay).
    task = await db.scalar(select(Task).where(Task.id == task_id))
    is_owner = user is not None and task is not None and task.user_id == user["user_id"]

    policy = await sharing_policy(db, task) if task is not None else None
    if policy is not None and not policy.enabled and not is_owner:
        return ShareAccess(ShareVerdict.NOT_FOUND, share=share, task=task)
    public = share.visibility == "public" and (policy is None or policy.public_allowed)

    if not public and user is None:
        # Organization/private share viewed anonymously: require login.
        return ShareAccess(ShareVerdict.LOGIN_REQUIRED, share=share)

    # For non-public shares, enforce org membership: the viewer must be the task
    # owner or share an organization with the task owner. This prevents a logged-in
    # user from a different org reading another org's private conversation.
    if not public and not is_owner:
        allowed = False
        if task is not None and task.organization_id is not None and user is not None:
            member_result = await db.execute(
                select(Membership).where(
                    Membership.user_id == user["user_id"],
                    Membership.organization_id == task.organization_id,
                )
            )
            allowed = member_result.scalar_one_or_none() is not None
        if not allowed:
            return ShareAccess(ShareVerdict.NOT_FOUND, share=share, task=task)

    return ShareAccess(ShareVerdict.ALLOWED, share=share, task=task, is_owner=is_owner)
