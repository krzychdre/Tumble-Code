"""Tests for the share/backfill pipeline fixes and the web task viewer.

Covers the three backend blockers that were preventing tasks from ever
persisting, plus the new server-rendered web routes:

- Blocker B: POST /api/extension/share returns 404 (not 200) for an unknown
  task, so the extension knows to backfill and retry.
- Blocker C: POST /api/events/backfill creates the parent Task row and replaces
  the message set idempotently on re-share.
- Web: /app requires a session; task detail enforces ownership; /shared honours
  the share visibility.
"""

import json

import pytest
from sqlalchemy import select, func

from src.dependencies import get_current_user
from src.auth.web_session import get_web_user_optional, WebUser
from src.models.user import User
from src.models.task import Task, TaskMessage, TaskShare
from src.services.settings_service import get_extension_settings


# --- helpers ---------------------------------------------------------------


async def _seed_user(db_session, user_id="user_test", email="t@example.com"):
    user = User(
        id=user_id,
        authentik_id=f"ak_{user_id}",
        email=email,
        first_name="Test",
        last_name="User",
    )
    db_session.add(user)
    await db_session.commit()
    return user


def _override_current_user(client_app, user_id="user_test"):
    client_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": user_id,
        "org_id": None,
    }


def _override_web_user(client_app, user_id="user_test", email="t@example.com"):
    web_user: WebUser = {
        "user_id": user_id,
        "session_id": "sess_test",
        "email": email,
        "name": "Test User",
        "image_url": None,
    }
    client_app.dependency_overrides[get_web_user_optional] = lambda: web_user


def _msgs():
    return [
        {"ts": 1, "type": "say", "say": "text", "text": "Build me a feature"},
        {"ts": 2, "type": "say", "say": "reasoning", "text": "thinking..."},
        {"ts": 3, "type": "say", "say": "completion_result", "text": "Done"},
    ]


def _backfill_files(task_id, messages):
    return {
        "file": ("task.json", json.dumps(messages), "application/json"),
    }, {"taskId": task_id, "properties": "{}"}


# --- Blocker A: org-less settings advertise task sharing with a live version --


async def test_org_less_settings_enable_sharing_with_nonzero_version(db_session):
    """Org-less extension settings must advertise task sharing AND carry a
    non-zero, content-derived version. The client caches org settings and only
    replaces them when `version` changes; a constant 0 leaves an already-cached
    (cloudSettings=null) client with the Share button permanently disabled."""
    res = await get_extension_settings(db=db_session, user_id="user_test", org_id=None)
    data = res.model_dump(by_alias=True)
    org = data["organization"]
    assert org["cloudSettings"]["enableTaskSharing"] is True
    assert org["cloudSettings"]["allowPublicTaskSharing"] is True
    # Must differ from the stale cached default of 0 so the client refreshes.
    assert org["version"] != 0


def _find_nulls(obj, path=""):
    """Return dotted paths of every JSON `null` found anywhere in the response."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(f"{path}.{k}") if v is None else out.extend(_find_nulls(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.extend(_find_nulls(v, f"{path}[{i}]"))
    return out


async def test_extension_settings_http_has_no_null_fields(client, db_session):
    """The serialized /api/extension-settings response must contain NO JSON nulls.

    The client parses this with Zod schemas whose optional fields use `.optional()`,
    which accepts `undefined` but REJECTS `null`. If Pydantic serializes unset
    Optionals as null, the client parse fails, CloudSettingsService never caches the
    settings, `canShareTask()` returns false, and the Share button is permanently
    disabled. `response_model_exclude_none=True` on the route prevents this.
    """
    await _seed_user(db_session)
    from src.main import app

    _override_current_user(app)
    try:
        resp = client.get("/api/extension-settings")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200
    data = resp.json()
    nulls = _find_nulls(data)
    assert nulls == [], f"response must not contain null fields, found: {nulls}"
    assert data["organization"]["cloudSettings"]["enableTaskSharing"] is True


# --- Blocker B: share returns 404 for unknown task -------------------------


async def test_share_unknown_task_returns_404(client, db_session):
    await _seed_user(db_session)
    from src.main import app

    _override_current_user(app)
    try:
        resp = client.post(
            "/api/extension/share",
            json={"taskId": "does-not-exist", "visibility": "organization"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404


async def test_share_existing_task_response_has_no_null_fields(
    client, db_session, session_factory
):
    """The serialized /api/extension/share success body must contain NO JSON nulls.

    The client parses this with the Zod shareResponseSchema whose optional fields use
    `.optional()`, which accepts `undefined` but REJECTS `null`. Without
    `response_model_exclude_none=True`, the unset `error` field serializes as null,
    the client parse throws, and the extension shows "Failed to share task" even
    though the share row was created. `response_model_exclude_none=True` prevents it.
    """
    await _seed_user(db_session)
    from src.main import app

    _override_current_user(app)
    # Backfill first so the parent Task row exists (share 404s otherwise).
    files, data = _backfill_files("task-share", _msgs())
    try:
        client.post("/api/events/backfill", files=files, data=data)
        resp = client.post(
            "/api/extension/share",
            json={"taskId": "task-share", "visibility": "organization"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200
    body = resp.json()
    nulls = _find_nulls(body)
    assert nulls == [], f"share response must not contain null fields, found: {nulls}"
    assert body["success"] is True
    assert "error" not in body  # unset Optional must be omitted, never null
    assert body["shareUrl"].endswith("/shared/task-share")


# --- Blocker C: backfill creates Task + replaces messages ------------------


async def test_backfill_creates_task_and_messages(client, db_session, session_factory):
    await _seed_user(db_session)
    from src.main import app

    _override_current_user(app)
    files, data = _backfill_files("task-1", _msgs())
    try:
        resp = client.post("/api/events/backfill", files=files, data=data)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-1"))).scalar_one()
        assert task.user_id == "user_test"
        n = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(TaskMessage.task_id == "task-1")
            )
        ).scalar_one()
        assert n == 3


async def test_backfill_is_idempotent_on_reshare(client, db_session, session_factory):
    await _seed_user(db_session)
    from src.main import app

    _override_current_user(app)
    try:
        files, data = _backfill_files("task-2", _msgs())
        client.post("/api/events/backfill", files=files, data=data)
        # Re-share with a different (shorter) message set.
        files, data = _backfill_files("task-2", _msgs()[:1])
        client.post("/api/events/backfill", files=files, data=data)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        n = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(TaskMessage.task_id == "task-2")
            )
        ).scalar_one()
        # Replaced, not appended.
        assert n == 1
        tasks = (await s.execute(select(func.count(Task.id)).where(Task.id == "task-2"))).scalar_one()
        assert tasks == 1


# --- Web: /app requires a session ------------------------------------------


async def test_app_redirects_to_login_without_session(client):
    resp = client.get("/app", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_app_lists_owned_tasks(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-9", user_id="user_test"))
        s.add(TaskMessage(task_id="task-9", message_data=json.dumps(_msgs()[0])))
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "Build me a feature" in resp.text


# --- Web: task detail enforces ownership -----------------------------------


async def test_task_detail_not_found_for_non_owner(client, db_session, session_factory):
    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-owned", user_id="owner"))
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="intruder")
    try:
        resp = client.get("/app/tasks/task-owned")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 404


# --- Web: /shared honours visibility ---------------------------------------


async def test_shared_public_allows_anonymous(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-pub", user_id="user_test"))
        s.add(TaskMessage(task_id="task-pub", message_data=json.dumps(_msgs()[0])))
        s.add(
            TaskShare(
                task_id="task-pub",
                visibility="public",
                share_url="http://testserver/shared/task-pub",
            )
        )
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


# --- Web: live remote-control surface only on the owner page ----------------


async def test_owner_task_detail_renders_live_controls(
    client, db_session, session_factory, monkeypatch
):
    """The owner's task page must expose the interactive bridge surface: the
    live header, the chat/auto-approve controls, and the live.js loader — fed by
    the embedded live-config. This is what makes the page drive the task. The
    page reads `settings.bridge_enabled` per request, so enable it here."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-live", user_id="user_test"))
        s.add(TaskMessage(task_id="task-live", message_data=json.dumps(_msgs()[0])))
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app/tasks/task-live")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' in body
    assert 'id="chat-input"' in body
    assert 'id="live-config"' in body
    assert "/static/live.js" in body
    # The config must carry the task id and the bridge path for the client.
    assert '"taskId": "task-live"' in body


async def test_shared_page_anonymous_never_renders_live_controls(
    client, db_session, session_factory, monkeypatch
):
    """A public share link viewed anonymously is strictly read-only — it must NOT
    ship the live controls or the socket.io/live.js bundle, even when the bridge is
    enabled. Control is owner-only."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-pub2", user_id="user_test"))
        s.add(TaskMessage(task_id="task-pub2", message_data=json.dumps(_msgs()[0])))
        s.add(
            TaskShare(
                task_id="task-pub2",
                visibility="public",
                share_url="http://testserver/shared/task-pub2",
            )
        )
        await s.commit()

    resp = client.get("/shared/task-pub2")
    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' not in body
    assert "/static/live.js" not in body


async def test_shared_owner_gets_live_controls(
    client, db_session, session_factory, monkeypatch
):
    """The owner opening their own share URL gets the live, drivable surface — so a
    freshly-shared task is remote-controllable straight from its share link."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-own-live", user_id="user_test"))
        s.add(TaskMessage(task_id="task-own-live", message_data=json.dumps(_msgs()[0])))
        s.add(
            TaskShare(
                task_id="task-own-live",
                visibility="public",
                share_url="http://testserver/shared/task-own-live",
            )
        )
        await s.commit()

    from src.main import app

    _override_web_user(app)  # logged in as "user_test" (the owner)
    try:
        resp = client.get("/shared/task-own-live")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' in body
    assert "/static/live.js" in body
    assert '"taskId": "task-own-live"' in body
    # The owner driving their own task is not "read-only".
    assert "read-only" not in body


async def test_delete_task_removes_task_messages_and_share(
    client, db_session, session_factory
):
    """Owner deleting a task wipes the Task row and everything hanging off it —
    messages and share rows — from the DB, and redirects back to the list."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-del", user_id="user_test"))
        s.add(TaskMessage(task_id="task-del", message_data=json.dumps(_msgs()[0])))
        s.add(
            TaskShare(
                task_id="task-del",
                visibility="public",
                share_url="http://testserver/shared/task-del",
            )
        )
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.post("/app/tasks/task-del/delete", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert resp.headers["location"] == "/app"

    async with session_factory() as s:
        tasks = (
            await s.execute(select(func.count(Task.id)).where(Task.id == "task-del"))
        ).scalar_one()
        msgs = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(TaskMessage.task_id == "task-del")
            )
        ).scalar_one()
        shares = (
            await s.execute(
                select(func.count(TaskShare.id)).where(TaskShare.task_id == "task-del")
            )
        ).scalar_one()
        assert tasks == 0
        assert msgs == 0
        assert shares == 0


async def test_delete_task_non_owner_is_noop(client, db_session, session_factory):
    """A non-owner POSTing the delete route never touches another user's data:
    the task and its messages survive (silent no-op, still a 303 to the list)."""
    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-keep", user_id="owner"))
        s.add(TaskMessage(task_id="task-keep", message_data=json.dumps(_msgs()[0])))
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="intruder", email="intruder@example.com")
    try:
        resp = client.post("/app/tasks/task-keep/delete", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    async with session_factory() as s:
        tasks = (
            await s.execute(select(func.count(Task.id)).where(Task.id == "task-keep"))
        ).scalar_one()
        assert tasks == 1


async def test_delete_task_requires_session(client):
    """An unauthenticated delete POST redirects to login and deletes nothing."""
    resp = client.post("/app/tasks/whatever/delete", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_shared_link_404s_after_owner_deletes(
    client, db_session, session_factory
):
    """Once the owner deletes the task, its public /shared link 404s."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-gone", user_id="user_test"))
        s.add(TaskMessage(task_id="task-gone", message_data=json.dumps(_msgs()[0])))
        s.add(
            TaskShare(
                task_id="task-gone",
                visibility="public",
                share_url="http://testserver/shared/task-gone",
            )
        )
        await s.commit()

    # Visible before delete.
    assert client.get("/shared/task-gone").status_code == 200

    from src.main import app

    _override_web_user(app)
    try:
        client.post("/app/tasks/task-gone/delete")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert client.get("/shared/task-gone").status_code == 404


async def test_shared_nonowner_stays_readonly(
    client, db_session, session_factory, monkeypatch
):
    """A logged-in viewer who does NOT own the task gets the read-only share view —
    control never leaks to non-owners."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-other", user_id="owner"))
        s.add(TaskMessage(task_id="task-other", message_data=json.dumps(_msgs()[0])))
        s.add(
            TaskShare(
                task_id="task-other",
                visibility="public",
                share_url="http://testserver/shared/task-other",
            )
        )
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="intruder", email="intruder@example.com")
    try:
        resp = client.get("/shared/task-other")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' not in body
    assert "/static/live.js" not in body
