"""A share link's lifetime and its revocation.

The organization's ``task_share_expiration_days`` is written to the share as
``expires_at`` when the task is shared; past it the link answers not found,
like a task never shared. The owner can revoke a link at any time, from the
task page or through the extension API.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.auth.web_session import get_web_user_optional
from src.dependencies import get_current_user
from src.models.organization import Membership, Organization
from src.models.settings import OrganizationSettings
from src.models.task import Task, TaskShare

from tests.web_helpers import (
    _add_message,
    _msgs,
    _override_current_user,
    _override_web_user,
    _seed_user,
    _summarize,
)


async def _seed_task(session_factory, db_session, *, org_days=None, with_org=True):
    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    await _seed_user(db_session, user_id="other", email="other@example.com")
    async with session_factory() as s:
        org = None
        if with_org:
            org = "org-a"
            s.add(Organization(id=org, name="A"))
            s.add(Membership(user_id="owner", organization_id=org, role="org:member"))
            if org_days is not False:
                s.add(
                    OrganizationSettings(
                        organization_id=org, task_share_expiration_days=org_days
                    )
                )
        s.add(Task(id="t-1", user_id="owner", organization_id=org))
        await _add_message(s, "t-1", _msgs()[0])
        await _summarize(s, "t-1")
        await s.commit()


def _share(client, user_id="owner", task_id="t-1"):
    from src.main import app

    _override_current_user(app, user_id=user_id)
    try:
        return client.post(
            "/api/extension/share", json={"taskId": task_id, "visibility": "public"}
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _stored_share(session_factory):
    async with session_factory() as s:
        return await s.scalar(select(TaskShare).where(TaskShare.task_id == "t-1"))


def _as_utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# --- the lifetime -----------------------------------------------------------------


async def test_sharing_writes_the_organizations_link_lifetime(
    client, db_session, session_factory
):
    await _seed_task(session_factory, db_session, org_days=7)

    before = datetime.now(timezone.utc)
    assert _share(client).status_code == 200
    share = await _stored_share(session_factory)

    expires_at = _as_utc(share.expires_at)
    assert before + timedelta(days=7) <= expires_at
    assert expires_at <= datetime.now(timezone.utc) + timedelta(days=7)


@pytest.mark.parametrize(
    "seed",
    [
        {"with_org": False},  # no organization
        {"org_days": False},  # an organization without a settings row
        {"org_days": 0},  # a lifetime of 0 means none
    ],
)
async def test_without_a_lifetime_a_link_does_not_expire(
    client, db_session, session_factory, seed
):
    await _seed_task(session_factory, db_session, **seed)

    assert _share(client).status_code == 200
    assert (await _stored_share(session_factory)).expires_at is None


async def test_sharing_again_starts_the_lifetime_afresh(
    client, db_session, session_factory
):
    await _seed_task(session_factory, db_session, org_days=7)
    async with session_factory() as s:
        s.add(
            TaskShare(
                task_id="t-1",
                visibility="public",
                expires_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
        )
        await s.commit()
    assert client.get("/shared/t-1").status_code == 404

    assert _share(client).status_code == 200

    expires_at = _as_utc((await _stored_share(session_factory)).expires_at)
    assert expires_at > datetime.now(timezone.utc) + timedelta(days=6)
    assert client.get("/shared/t-1").status_code == 200


def test_a_huge_lifetime_is_bounded_instead_of_overflowing():
    from src.services.share_service import share_expiry

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert share_expiry(10**9, now) == now + timedelta(days=36500)
    assert share_expiry(None, now) is None


@pytest.mark.parametrize("viewer", [None, "owner"])
async def test_an_expired_link_is_not_found(
    client, db_session, session_factory, viewer
):
    await _seed_task(session_factory, db_session)
    async with session_factory() as s:
        s.add(
            TaskShare(
                task_id="t-1",
                visibility="public",
                share_url="http://testserver/shared/t-1",
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            )
        )
        await s.commit()

    from src.main import app

    if viewer:
        _override_web_user(app, user_id=viewer, email=f"{viewer}@example.com")
    try:
        page = client.get("/shared/t-1", follow_redirects=False)
        image = client.get("/shared/t-1/images", params={"ts": 1, "path": "a.png"})
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert page.status_code == 404
    assert "Build me a feature" not in page.text
    assert image.status_code == 404


async def test_a_link_within_its_lifetime_still_opens(
    client, db_session, session_factory
):
    await _seed_task(session_factory, db_session)
    async with session_factory() as s:
        s.add(
            TaskShare(
                task_id="t-1",
                visibility="public",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
        )
        await s.commit()

    assert client.get("/shared/t-1").status_code == 200


# --- revoking ---------------------------------------------------------------------


async def _shared(session_factory, db_session):
    await _seed_task(session_factory, db_session)
    async with session_factory() as s:
        s.add(
            TaskShare(
                task_id="t-1",
                visibility="public",
                share_url="http://testserver/shared/t-1",
            )
        )
        await s.commit()


def _api_unshare(client, user_id):
    from src.main import app

    _override_current_user(app, user_id=user_id)
    try:
        return client.delete("/api/extension/share/t-1")
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_the_owner_revokes_a_link_through_the_api(
    client, db_session, session_factory
):
    await _shared(session_factory, db_session)
    assert client.get("/shared/t-1").status_code == 200

    resp = _api_unshare(client, "owner")

    assert resp.json() == {"success": True, "revoked": True}
    assert await _stored_share(session_factory) is None
    assert client.get("/shared/t-1").status_code == 404
    # Once more: nothing left to revoke, same shape.
    assert _api_unshare(client, "owner").json() == {"success": True, "revoked": False}


async def test_nobody_else_can_revoke_a_link(client, db_session, session_factory):
    await _shared(session_factory, db_session)

    assert _api_unshare(client, "other").json() == {"success": True, "revoked": False}
    from src.main import app

    _override_web_user(app, user_id="other", email="other@example.com")
    try:
        client.post("/app/tasks/t-1/unshare", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert await _stored_share(session_factory) is not None
    assert client.get("/shared/t-1").status_code == 200


async def test_the_owner_sees_the_link_and_stops_sharing_from_the_task_page(
    client, db_session, session_factory
):
    await _shared(session_factory, db_session)
    from src.main import app

    _override_web_user(app, user_id="owner", email="owner@example.com")
    try:
        page = client.get("/app/tasks/t-1")
        resp = client.post("/app/tasks/t-1/unshare", follow_redirects=False)
        after = client.get("/app/tasks/t-1")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert "Shared publicly" in page.text
    assert 'action="/app/tasks/t-1/unshare"' in page.text
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/tasks/t-1"
    assert await _stored_share(session_factory) is None
    assert client.get("/shared/t-1").status_code == 404
    assert "/unshare" not in after.text
