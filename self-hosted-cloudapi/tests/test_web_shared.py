"""The share-link page (/shared/{task_id}) honours the share's visibility."""

from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskShare

from tests.web_helpers import (
    _seed_user,
    _override_web_user,
    _msgs,
    _add_message,
    _summarize,
)


# --- Web: /shared honours visibility ---------------------------------------


async def test_shared_public_allows_anonymous(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-pub", user_id="user_test"))
        await _add_message(s, "task-pub", _msgs()[0])
        s.add(
            TaskShare(
                task_id="task-pub",
                visibility="public",
                share_url="http://testserver/shared/task-pub",
            )
        )
        await _summarize(s, "task-pub")
        await s.commit()

    resp = client.get("/shared/task-pub")
    assert resp.status_code == 200
    assert "Build me a feature" in resp.text


async def test_shared_private_requires_login(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-priv", user_id="user_test"))
        s.add(TaskShare(task_id="task-priv", visibility="organization"))
        await s.commit()

    resp = client.get("/shared/task-priv", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_shared_unknown_returns_404(client):
    resp = client.get("/shared/nope")
    assert resp.status_code == 404


# --- Security: /shared org-visibility blocks other-org users (BUG B) -------


async def test_shared_organization_visibility_blocks_other_org_user(
    client, db_session, session_factory
):
    """An organization-visibility share must only be viewable by the task owner
    or users who share an organization with the owner. A logged-in user from a
    different org gets 404 (not-found), not the conversation."""
    from src.models.organization import Organization, Membership

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    await _seed_user(db_session, user_id="viewer", email="viewer@example.com")

    async with session_factory() as s:
        org_a = Organization(id="org-a", name="Org A")
        org_b = Organization(id="org-b", name="Org B")
        s.add_all([org_a, org_b])
        # Owner is in org-a; viewer is in org-b (different org).
        s.add(Membership(user_id="owner", organization_id="org-a", role="org:member"))
        s.add(Membership(user_id="viewer", organization_id="org-b", role="org:member"))
        s.add(Task(id="task-org-vis", user_id="owner", organization_id="org-a"))
        await _add_message(s, "task-org-vis", _msgs()[0])
        s.add(TaskShare(task_id="task-org-vis", visibility="organization"))
        await _summarize(s, "task-org-vis")
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="viewer", email="viewer@example.com")
    try:
        resp = client.get("/shared/task-org-vis")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 404


async def test_shared_organization_visibility_allows_same_org_user(
    client, db_session, session_factory
):
    """A logged-in user in the same org as the task owner CAN view an
    organization-visibility share (positive control for the previous test)."""
    from src.models.organization import Organization, Membership

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    await _seed_user(db_session, user_id="colleague", email="colleague@example.com")

    async with session_factory() as s:
        org = Organization(id="org-shared", name="Shared Org")
        s.add(org)
        s.add(Membership(user_id="owner", organization_id="org-shared", role="org:member"))
        s.add(Membership(user_id="colleague", organization_id="org-shared", role="org:member"))
        s.add(Task(id="task-org-same", user_id="owner", organization_id="org-shared"))
        await _add_message(s, "task-org-same", _msgs()[0])
        s.add(TaskShare(task_id="task-org-same", visibility="organization"))
        await _summarize(s, "task-org-same")
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="colleague", email="colleague@example.com")
    try:
        resp = client.get("/shared/task-org-same")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "Build me a feature" in resp.text
