"""Who may open ``/shared/{task_id}``: every branch of the share-view policy.

The policy sat inline in the ``/shared`` route. Its branches are pinned here as
one table through the route, so moving the policy into a service (CAPI-M5)
can be checked to decide every case exactly as before.
"""

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.organization import Membership, Organization
from src.models.task import Task, TaskShare

from tests.test_web_and_share import _add_message, _msgs, _override_web_user, _seed_user, _summarize


async def _seed(session_factory, db_session, visibility: str, task_org: str | None):
    """Owner ``owner`` in org-a; ``colleague`` in org-a; ``outsider`` in org-b;
    ``stranger`` in no org."""
    for user_id in ("owner", "colleague", "outsider", "stranger"):
        await _seed_user(db_session, user_id=user_id, email=f"{user_id}@example.com")
    async with session_factory() as s:
        s.add_all([Organization(id="org-a", name="A"), Organization(id="org-b", name="B")])
        s.add(Membership(user_id="owner", organization_id="org-a", role="org:member"))
        s.add(Membership(user_id="colleague", organization_id="org-a", role="org:member"))
        s.add(Membership(user_id="outsider", organization_id="org-b", role="org:member"))
        s.add(Task(id="t-share", user_id="owner", organization_id=task_org))
        await _add_message(s, "t-share", _msgs()[0])
        s.add(TaskShare(task_id="t-share", visibility=visibility, share_url="http://testserver/shared/t-share"))
        await _summarize(s, "t-share")
        await s.commit()


# (visibility, the task's organization, viewer or None for anonymous) -> status
CASES = [
    ("public", "org-a", None, 200),
    ("public", "org-a", "stranger", 200),
    ("public", "org-a", "owner", 200),
    ("public", None, None, 200),
    ("organization", "org-a", None, 303),
    ("organization", "org-a", "owner", 200),
    ("organization", "org-a", "colleague", 200),
    ("organization", "org-a", "outsider", 404),
    ("organization", "org-a", "stranger", 404),
    ("organization", None, "owner", 200),
    # With no organization on the task only the owner may look.
    ("organization", None, "colleague", 404),
    ("organization", None, "stranger", 404),
    ("private", None, None, 303),
    ("private", "org-a", "colleague", 200),
]


@pytest.mark.parametrize("visibility,task_org,viewer,status", CASES)
async def test_share_view_policy(client, db_session, session_factory, visibility, task_org, viewer, status):
    await _seed(session_factory, db_session, visibility, task_org)

    from src.main import app

    if viewer:
        _override_web_user(app, user_id=viewer, email=f"{viewer}@example.com")
    try:
        resp = client.get("/shared/t-share", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == status
    if status == 303:
        assert resp.headers["location"] == "/app/login"
    elif status == 200:
        assert "Build me a feature" in resp.text
    else:
        assert "Build me a feature" not in resp.text


async def test_share_view_of_an_unknown_task_is_404_for_everybody(client, db_session):
    await _seed_user(db_session)

    from src.main import app

    assert client.get("/shared/nope", follow_redirects=False).status_code == 404
    _override_web_user(app)
    try:
        assert client.get("/shared/nope", follow_redirects=False).status_code == 404
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)


# --- services/task_access.py, called directly ------------------------------------------------------------------


def _viewer(user_id):
    return {"user_id": user_id, "session_id": "s", "email": f"{user_id}@example.com", "name": user_id}


@pytest.mark.parametrize("visibility,task_org,viewer,status", CASES)
async def test_the_service_decides_like_the_route(db_session, session_factory, visibility, task_org, viewer, status):
    from src.services.task_access import ShareVerdict, shared_view_access

    await _seed(session_factory, db_session, visibility, task_org)
    access = await shared_view_access(db_session, "t-share", _viewer(viewer) if viewer else None)

    expected = {200: ShareVerdict.ALLOWED, 303: ShareVerdict.LOGIN_REQUIRED, 404: ShareVerdict.NOT_FOUND}
    assert access.verdict is expected[status]
    assert access.share is not None
    # Only the owner's view is live.
    assert access.is_owner is (access.verdict is ShareVerdict.ALLOWED and viewer == "owner")
    if access.verdict is ShareVerdict.ALLOWED:
        assert access.task is not None and access.task.id == "t-share"


async def test_the_service_finds_no_share_for_an_unknown_task(db_session):
    from src.services.task_access import ShareVerdict, shared_view_access

    access = await shared_view_access(db_session, "nope", _viewer("owner"))
    assert access.verdict is ShareVerdict.NOT_FOUND
    assert (access.share, access.task, access.is_owner) == (None, None, False)
