"""Tests for the share/backfill pipeline fixes and the share endpoint's policy.

Covers the three backend blockers that were preventing tasks from ever
persisting, and the server-side checks on sharing:

- Blocker B: POST /api/extension/share returns 404 (not 200) for an unknown
  task, so the extension knows to backfill and retry.
- Blocker C: POST /api/events/backfill creates the parent Task row and replaces
  the message set idempotently on re-share.
- Security: share ownership, the visibility values and the org policy.

The web panel's own tests moved out by page (CAPI-M5): test_web_tasks.py,
test_web_shared.py, test_web_metrics.py and test_web_settings.py.
"""

from sqlalchemy import select, func

from src.dependencies import get_current_user
from src.models.task import Task, TaskMessage, TaskShare
from src.realtime.hub import registry
from src.services.settings_service import get_extension_settings

from tests.web_helpers import (
    _seed_user,
    _override_current_user,
    _msgs,
    _backfill_files,
)


# --- Blocker A: org-less settings advertise task sharing with a live version --


async def test_org_less_settings_enable_sharing_with_nonzero_version(db_session):
    """Org-less extension settings must advertise task sharing AND carry a
    non-zero, content-derived version. The client caches org settings and only
    replaces them when `version` changes; a constant 0 leaves an already-cached
    (cloudSettings=null) client with the Share button permanently disabled."""
    # A token is only ever issued to a signed-in user, so the user row exists;
    # user_settings.user_id is a foreign key to it.
    await _seed_user(db_session)
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


async def test_backfill_into_another_users_task_is_404_and_changes_nothing(
    client, db_session, session_factory
):
    """DEF-S4: a backfill names its task by id only, so without an ownership
    check any signed-in user could replace another user's conversation by
    uploading a task.json under that user's task id. The foreign upload must
    get the same 404 the share endpoint gives for a task the caller does not
    own, and the owner's task row and messages must stay exactly as they were.
    """
    await _seed_user(db_session, "victim", "victim@example.com")
    await _seed_user(db_session, "attacker", "attacker@example.com")
    from src.main import app

    _override_current_user(app, "victim")
    try:
        files, data = _backfill_files("task-victim", _msgs())
        assert client.post("/api/events/backfill", files=files, data=data).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        before = (
            await s.execute(
                select(TaskMessage.message_data)
                .where(TaskMessage.task_id == "task-victim")
                .order_by(TaskMessage.id)
            )
        ).scalars().all()
    assert len(before) == 3

    forged = [{"ts": 9, "type": "say", "say": "text", "text": "overwritten by attacker"}]
    _override_current_user(app, "attacker")
    try:
        files, data = _backfill_files("task-victim", forged)
        data["workspacePath"] = "/attacker/path"
        resp = client.post("/api/events/backfill", files=files, data=data)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-victim"))).scalar_one()
        assert task.user_id == "victim"
        assert task.workspace_path != "/attacker/path"
        after = (
            await s.execute(
                select(TaskMessage.message_data)
                .where(TaskMessage.task_id == "task-victim")
                .order_by(TaskMessage.id)
            )
        ).scalars().all()
    assert after == before


async def test_backfill_persists_explicit_workspace_path(client, db_session, session_factory):
    """The explicit client `workspacePath` field is stamped on the task, so an
    offline share (no live bridge) still records its project/worktree."""
    await _seed_user(db_session)
    from src.main import app

    ws = "/home/krzych/Projekty/QUB-IT/Roo-Code-worktree-x"
    _override_current_user(app)
    files, data = _backfill_files("task-ws-explicit", _msgs())
    data["workspacePath"] = ws
    try:
        resp = client.post("/api/events/backfill", files=files, data=data)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200
    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-ws-explicit"))).scalar_one()
        assert task.workspace_path == ws


async def test_backfill_falls_back_to_registry_workspace_path(client, db_session, session_factory):
    """An older client that doesn't send `workspacePath` still gets the project
    recorded, sourced from the live registered instance for that user."""
    await _seed_user(db_session)
    from src.main import app

    ws = "/home/krzych/Projekty/QUB-IT/Roo-Code"
    registry.register_extension("ext_fallback", "user_test", {"workspacePath": ws})

    _override_current_user(app)
    files, data = _backfill_files("task-ws-fallback", _msgs())  # no workspacePath field
    try:
        resp = client.post("/api/events/backfill", files=files, data=data)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        registry.detach("ext_fallback")

    assert resp.status_code == 200
    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-ws-fallback"))).scalar_one()
        assert task.workspace_path == ws


# --- Security: share_task ownership check (BUG A) --------------------------


async def test_share_task_by_non_owner_returns_not_found(client, db_session, session_factory):
    """A user may only share tasks they own. Sharing another user's task must
    return the same 'Task not found' response as a missing task - never leak
    that the task exists, and never create a share row."""
    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    await _seed_user(db_session, user_id="intruder", email="intruder@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-own-a", user_id="owner"))
        await s.commit()

    from src.main import app

    _override_current_user(app, user_id="intruder")
    try:
        resp = client.post(
            "/api/extension/share",
            json={"taskId": "task-own-a", "visibility": "organization"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # The endpoint raises 404 for "Task not found" results.
    assert resp.status_code == 404

    # No share row should have been created.
    async with session_factory() as s:
        shares = (
            await s.execute(
                select(func.count(TaskShare.id)).where(TaskShare.task_id == "task-own-a")
            )
        ).scalar_one()
        assert shares == 0


# --- Security: visibility Literal constraint (BUG C) -----------------------


async def test_share_visibility_rejects_invalid_value(client, db_session, session_factory):
    """The visibility field must only accept 'organization' or 'public'.
    An invalid value is rejected with 422 (Pydantic validation error)."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-vis", user_id="user_test"))
        await s.commit()

    from src.main import app

    _override_current_user(app)
    try:
        resp = client.post(
            "/api/extension/share",
            json={"taskId": "task-vis", "visibility": "secret"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 422


# --- Security: org policy enforcement server-side (CB-8) -------------------


async def test_share_public_rejected_when_org_disallows_public(client, db_session, session_factory):
    """When the org has allow_public_task_sharing=False, a public-visibility
    share must be rejected with 403. Organization-visibility shares are still
    allowed."""
    from src.models.organization import Organization, Membership
    from src.models.settings import OrganizationSettings

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Organization(id="org-nopub", name="NoPub Org"))
        s.add(Membership(user_id="owner", organization_id="org-nopub", role="org:member"))
        s.add(Task(id="task-nopub", user_id="owner", organization_id="org-nopub"))
        s.add(OrganizationSettings(
            organization_id="org-nopub",
            enable_task_sharing=True,
            allow_public_task_sharing=False,
        ))
        await s.commit()

    from src.main import app

    _override_current_user(app, user_id="owner")
    try:
        resp = client.post(
            "/api/extension/share",
            json={"taskId": "task-nopub", "visibility": "public"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 403

    # No share row should have been created.
    async with session_factory() as s:
        shares = (
            await s.execute(
                select(func.count(TaskShare.id)).where(TaskShare.task_id == "task-nopub")
            )
        ).scalar_one()
        assert shares == 0


async def test_share_organization_allowed_when_org_disallows_public(client, db_session, session_factory):
    """When the org has allow_public_task_sharing=False but enable_task_sharing=True,
    an organization-visibility share is still allowed."""
    from src.models.organization import Organization, Membership
    from src.models.settings import OrganizationSettings

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Organization(id="org-nopub2", name="NoPub Org 2"))
        s.add(Membership(user_id="owner", organization_id="org-nopub2", role="org:member"))
        s.add(Task(id="task-nopub-org", user_id="owner", organization_id="org-nopub2"))
        s.add(OrganizationSettings(
            organization_id="org-nopub2",
            enable_task_sharing=True,
            allow_public_task_sharing=False,
        ))
        await s.commit()

    from src.main import app

    _override_current_user(app, user_id="owner")
    try:
        resp = client.post(
            "/api/extension/share",
            json={"taskId": "task-nopub-org", "visibility": "organization"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200


async def test_share_all_visibilities_rejected_when_sharing_disabled(client, db_session, session_factory):
    """When the org has enable_task_sharing=False, both visibility values are
    rejected with 403."""
    from src.models.organization import Organization, Membership
    from src.models.settings import OrganizationSettings

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Organization(id="org-noshare", name="NoShare Org"))
        s.add(Membership(user_id="owner", organization_id="org-noshare", role="org:member"))
        s.add(Task(id="task-noshare", user_id="owner", organization_id="org-noshare"))
        s.add(OrganizationSettings(
            organization_id="org-noshare",
            enable_task_sharing=False,
            allow_public_task_sharing=True,
        ))
        await s.commit()

    from src.main import app

    _override_current_user(app, user_id="owner")
    try:
        resp_pub = client.post(
            "/api/extension/share",
            json={"taskId": "task-noshare", "visibility": "public"},
        )
        resp_org = client.post(
            "/api/extension/share",
            json={"taskId": "task-noshare", "visibility": "organization"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp_pub.status_code == 403
    assert resp_org.status_code == 403


async def test_share_allowed_when_no_org_settings_configured(client, db_session, session_factory):
    """When the task has an organization_id but no OrganizationSettings row exists,
    the permissive default applies: both visibilities are allowed (back-compat
    for existing self-hosted deployments that never configured org settings)."""
    from src.models.organization import Organization, Membership

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Organization(id="org-nosettings", name="NoSettings Org"))
        s.add(Membership(user_id="owner", organization_id="org-nosettings", role="org:member"))
        s.add(Task(id="task-nosettings", user_id="owner", organization_id="org-nosettings"))
        await s.commit()

    from src.main import app

    _override_current_user(app, user_id="owner")
    try:
        resp_pub = client.post(
            "/api/extension/share",
            json={"taskId": "task-nosettings", "visibility": "public"},
        )
        resp_org = client.post(
            "/api/extension/share",
            json={"taskId": "task-nosettings", "visibility": "organization"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp_pub.status_code == 200
    assert resp_org.status_code == 200


async def test_format_helpers_are_single_source_of_truth():
    """Every module that counts tokens must use the SAME ``num``/``fmt_tokens``/
    ``fmt_duration`` function objects from ``src.utils.format`` - not local copies.

    This guards against the CB-7 regression: two independent copies of ``_num``
    drifted (one counted ``bool``, one didn't), so a malformed ``tokensIn: true``
    inflated one view and not the other. If any module re-defines a local copy,
    identity fails.

    Token parsing moved out of ``web.py`` into ``task_summary.py`` when the task
    list stopped deriving its numbers at read time, so that module is now the one
    that must be pinned; the web presenters only format what they are handed.
    """
    from src.services import metrics_service, task_summary
    from src.utils import format as fmt
    from src.web import templating
    from src.web.presenters import settings as settings_presenter
    from src.web.presenters import task_detail, task_rows

    assert task_summary.num is fmt.num
    # The web presenters (routers/web.py before CAPI-M5) format through the
    # same functions.
    assert task_rows.fmt_tokens is fmt.fmt_tokens
    assert task_rows.fmt_duration is fmt.fmt_duration
    assert task_rows.fmt_cost is fmt.fmt_cost
    assert task_rows.fmt_int is fmt.fmt_int
    assert task_rows.plural is fmt.plural
    assert task_detail.fmt_tokens is fmt.fmt_tokens
    assert task_detail.fmt_duration is fmt.fmt_duration
    assert task_detail.fmt_cost is fmt.fmt_cost
    assert task_detail.fmt_int is fmt.fmt_int
    assert task_detail.plural is fmt.plural
    assert settings_presenter.fmt_bytes is fmt.fmt_bytes
    # The templates format through the same functions, registered as filters.
    for name, fn in fmt.JINJA_FILTERS.items():
        assert templating.templates.env.filters[name] is fn

    # metrics_service aliases ``num`` as ``_num`` for its internal call sites.
    assert metrics_service._num is fmt.num
    assert metrics_service.fmt_tokens is fmt.fmt_tokens
    assert metrics_service.fmt_duration is fmt.fmt_duration
