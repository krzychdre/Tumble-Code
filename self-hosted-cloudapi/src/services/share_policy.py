"""Whether a task may be shared, and shared publicly.

Two levels, both of which must allow it:

* the server: ENABLE_TASK_SHARING and ALLOW_PUBLIC_TASK_SHARING, which
  /api/extension-settings advertises to every client as the policy. They apply
  to every task, with or without an organization;
* the task's organization, when it has an OrganizationSettings row. Without a
  row the organization adds nothing (existing self-hosted deployments never
  configured one), and the model defaults are permissive, so only an explicit
  False restricts.

The policy is applied when a task is shared (share_service.share_task) and
when a shared page is opened (task_access.shared_view_access), so switching
sharing off also closes the links handed out before.

The organization's ``task_share_expiration_days`` (when it has a settings row
and the value is positive) is how long a link lasts: share_task writes the
share's ``expires_at`` from it, and shared_view_access answers not found past
it. Without an organization row a link lasts until it is revoked.
"""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from src.models.settings import OrganizationSettings
from src.models.task import Task


@dataclass(frozen=True)
class SharingPolicy:
    enabled: bool
    public_allowed: bool
    disabled_reason: str = ""
    public_disabled_reason: str = ""
    # Days a new share link lasts; None for no expiry.
    expiration_days: Optional[int] = None


async def sharing_policy(db: AsyncSession, task: Task) -> SharingPolicy:
    """The sharing policy that applies to ``task``."""
    if not settings.enable_task_sharing:
        reason = "Task sharing is disabled on this server"
        return SharingPolicy(False, False, reason, reason)

    org_settings = None
    if task.organization_id:
        org_settings = await db.scalar(
            select(OrganizationSettings).where(
                OrganizationSettings.organization_id == task.organization_id
            )
        )
    if org_settings is not None and org_settings.enable_task_sharing is False:
        reason = "Task sharing is disabled for this organization"
        return SharingPolicy(False, False, reason, reason)

    days = org_settings.task_share_expiration_days if org_settings else None
    expiration_days = days if days and days > 0 else None

    if not settings.allow_public_task_sharing:
        return SharingPolicy(
            True,
            False,
            "",
            "Public task sharing is disabled on this server",
            expiration_days,
        )
    if org_settings is not None and org_settings.allow_public_task_sharing is False:
        return SharingPolicy(
            True,
            False,
            "",
            "Public task sharing is disabled for this organization",
            expiration_days,
        )
    return SharingPolicy(True, True, expiration_days=expiration_days)
