"""Retention settings (/app/settings) and the sweep behind them.

Split out of test_web_and_share.py (CAPI-M5); the sections are unchanged.
"""

import json

from sqlalchemy import select, func

from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskShare
from src.models.event import TelemetryEvent
from src.services.metrics_service import compute_user_metrics

from tests.web_helpers import (
    _seed_user,
    _override_web_user,
    _msgs,
    _add_message,
)


# --- retention --------------------------------------------------------------


async def _make_task(session, task_id, user_id="user_test", *, age_days=0, shared=False):
    from datetime import datetime, timedelta, timezone

    when = datetime.now(timezone.utc) - timedelta(days=age_days)
    session.add(Task(id=task_id, user_id=user_id, title=f"Task {task_id}", updated_at=when))
    await session.flush()
    await _add_message(session, task_id, _msgs()[0])
    if shared:
        session.add(TaskShare(task_id=task_id, visibility="public",
                              share_url=f"http://testserver/shared/{task_id}"))
    await session.flush()


async def _policy(session, user_id="user_test", **fields):
    from src.services.retention_service import get_policy

    policy = await get_policy(session, user_id)
    for key, value in fields.items():
        setattr(policy, key, value)
    await session.flush()
    return policy


async def test_a_fresh_policy_deletes_nothing(db_session, session_factory):
    """Retention must never be something a deployment acquires by upgrading."""
    from src.services.retention_service import get_policy, plan_sweep

    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-old", age_days=400)
        await s.commit()

    async with session_factory() as s:
        policy = await get_policy(s, "user_test")
        assert policy.enabled is False
        plan = await plan_sweep(s, "user_test", policy)

    assert plan.is_empty, "a default policy must select nothing"


async def test_age_rule_selects_only_old_tasks(db_session, session_factory):
    from src.services.retention_service import plan_sweep

    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-fresh", age_days=1)
        await _make_task(s, "r-stale", age_days=100)
        policy = await _policy(s, max_age_days=30, max_tasks=None)
        plan = await plan_sweep(s, "user_test", policy)
        await s.commit()

    assert plan.task_ids == ["r-stale"]
    assert "older than 30 days" in plan.reasons["r-stale"]


async def test_count_rule_keeps_the_newest(db_session, session_factory):
    from src.services.retention_service import plan_sweep

    await _seed_user(db_session)
    async with session_factory() as s:
        for i in range(5):
            await _make_task(s, f"r-c{i}", age_days=i)
        policy = await _policy(s, max_age_days=None, max_tasks=2)
        plan = await plan_sweep(s, "user_test", policy)
        await s.commit()

    # Newest first: r-c0 and r-c1 survive.
    assert set(plan.task_ids) == {"r-c2", "r-c3", "r-c4"}


async def test_shared_tasks_are_exempt_by_default(db_session, session_factory):
    """A share URL was handed to somebody; a sweep should not silently break it."""
    from src.services.retention_service import plan_sweep

    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-shared", age_days=200, shared=True)
        await _make_task(s, "r-private", age_days=200)
        policy = await _policy(s, max_age_days=30, max_tasks=None, keep_shared=True)
        plan = await plan_sweep(s, "user_test", policy)
        await s.commit()

    assert plan.task_ids == ["r-private"]
    assert plan.exempt_shared == 1

    async with session_factory() as s:
        policy = await _policy(s, max_age_days=30, max_tasks=None, keep_shared=False)
        plan = await plan_sweep(s, "user_test", policy)
        await s.commit()

    assert set(plan.task_ids) == {"r-shared", "r-private"}


async def test_usage_telemetry_is_never_purged(db_session, session_factory):
    """The metrics page is built entirely from LLM Completion; nothing else in
    the database can reconstruct the cost history it holds."""
    from datetime import datetime, timedelta, timezone

    from src.services.retention_service import apply_sweep

    await _seed_user(db_session)
    old = datetime.now(timezone.utc) - timedelta(days=90)
    async with session_factory() as s:
        s.add(TelemetryEvent(user_id="user_test", event_type="LLM Completion",
                             properties=json.dumps({"cost": 1.5}), created_at=old))
        s.add(TelemetryEvent(user_id="user_test", event_type="Task Message",
                             properties=json.dumps({"message": {}}), created_at=old))
        policy = await _policy(s, purge_telemetry=True, telemetry_max_age_days=7,
                               max_age_days=None, max_tasks=None)
        await apply_sweep(s, "user_test", policy)
        await s.commit()

    async with session_factory() as s:
        rows = await s.execute(select(TelemetryEvent.event_type))
        kinds = [r[0] for r in rows.all()]

    assert kinds == ["LLM Completion"], "usage data must survive a telemetry purge"


async def test_a_telemetry_purge_keeps_everything_the_metrics_page_shows(
    db_session, session_factory
):
    """The metrics page reads two event types: ``LLM Completion`` (the
    conversation totals) and ``Embedding Usage`` (the code-index figure). Only
    the first was protected, so a purge erased the indexing history (DEF-C31).
    Whatever the page shows for "All time" must be identical after a purge."""
    from datetime import datetime, timedelta, timezone

    from src.services.metrics_service import EMBEDDING_EVENT, LLM_COMPLETION_EVENT
    from src.services.retention_service import PROTECTED_EVENT_TYPES, apply_sweep

    await _seed_user(db_session)
    old = datetime.now(timezone.utc) - timedelta(days=90)
    async with session_factory() as s:
        s.add(TelemetryEvent(
            user_id="user_test", event_type=LLM_COMPLETION_EVENT, created_at=old,
            properties=json.dumps({"taskId": "t-m", "modelId": "glm", "inputTokens": 100,
                                   "outputTokens": 20, "cost": 0.5}),
        ))
        s.add(TelemetryEvent(
            user_id="user_test", event_type=EMBEDDING_EVENT, created_at=old,
            properties=json.dumps({"promptTokens": 250000, "source": "code-index"}),
        ))
        s.add(TelemetryEvent(user_id="user_test", event_type="Task Message", created_at=old,
                             properties=json.dumps({"message": {}})))
        await s.commit()

    async with session_factory() as s:
        before = await compute_user_metrics(s, "user_test", "all")
    assert before["embeddings"]["tokens"] == 250000, "the fixture must show embeddings"
    assert before["totals"]["completions"] == 1

    async with session_factory() as s:
        policy = await _policy(s, purge_telemetry=True, telemetry_max_age_days=7,
                               max_age_days=None, max_tasks=None)
        plan = await apply_sweep(s, "user_test", policy)
        await s.commit()
    assert plan.event_count == 1, "only the Task Message event is purgeable"

    async with session_factory() as s:
        after = await compute_user_metrics(s, "user_test", "all")
        kinds = {r[0] for r in (await s.execute(select(TelemetryEvent.event_type))).all()}

    assert after == before
    assert kinds == {LLM_COMPLETION_EVENT, EMBEDDING_EVENT}
    assert {LLM_COMPLETION_EVENT, EMBEDDING_EVENT} <= set(PROTECTED_EVENT_TYPES)


async def test_sweep_never_touches_another_users_data(db_session, session_factory):
    from src.services.retention_service import apply_sweep

    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="other@example.com")
    async with session_factory() as s:
        await _make_task(s, "r-mine", age_days=200)
        await _make_task(s, "r-theirs", "user_other", age_days=200)
        policy = await _policy(s, max_age_days=30, max_tasks=None)
        await apply_sweep(s, "user_test", policy)
        await s.commit()

    async with session_factory() as s:
        rows = await s.execute(select(Task.id))
        assert {r[0] for r in rows.all()} == {"r-theirs"}


async def test_the_preview_matches_what_the_sweep_does(db_session, session_factory):
    """The settings page and the sweep must not be able to disagree - they run
    the same function."""
    from src.services.retention_service import apply_sweep, plan_sweep

    await _seed_user(db_session)
    async with session_factory() as s:
        for i in range(6):
            await _make_task(s, f"r-p{i}", age_days=i * 40)
        policy = await _policy(s, max_age_days=90, max_tasks=None)
        preview = await plan_sweep(s, "user_test", policy)
        await s.commit()

    previewed = set(preview.task_ids)
    assert previewed, "the fixture must actually select something"

    async with session_factory() as s:
        policy = await _policy(s, max_age_days=90, max_tasks=None)
        await apply_sweep(s, "user_test", policy)
        await s.commit()

    async with session_factory() as s:
        rows = await s.execute(select(Task.id))
        remaining = {r[0] for r in rows.all()}

    assert previewed & remaining == set(), "everything previewed must be gone"
    assert remaining == {f"r-p{i}" for i in range(6)} - previewed


async def test_apply_records_what_it_did(db_session, session_factory):
    from src.services.retention_service import apply_sweep, get_policy

    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-rec", age_days=200)
        policy = await _policy(s, max_age_days=30, max_tasks=None)
        await apply_sweep(s, "user_test", policy)
        await s.commit()

    async with session_factory() as s:
        policy = await get_policy(s, "user_test")
        assert policy.last_run_at is not None
        assert policy.last_deleted_tasks == 1


async def test_scheduled_sweep_skips_disabled_policies(db_session, session_factory):
    from src.services.retention_service import sweep_all_enabled

    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_off", email="off@example.com")
    async with session_factory() as s:
        await _make_task(s, "r-on", age_days=200)
        await _make_task(s, "r-off", "user_off", age_days=200)
        await _policy(s, "user_test", enabled=True, max_age_days=30, max_tasks=None)
        await _policy(s, "user_off", enabled=False, max_age_days=30, max_tasks=None)
        await s.commit()

    async with session_factory() as s:
        processed = await sweep_all_enabled(s)
        await s.commit()

    assert processed == 1
    async with session_factory() as s:
        rows = await s.execute(select(Task.id))
        assert {r[0] for r in rows.all()} == {"r-off"}


async def test_settings_page_shows_the_preview(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-ui", age_days=200)
        await _policy(s, max_age_days=30, max_tasks=None)
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.get("/app/settings")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "What would be deleted right now" in resp.text
    assert "older than 30 days" in resp.text


async def test_opening_the_settings_page_writes_nothing(client, db_session, session_factory):
    """A GET must not write. The page used to create the user's default policy
    row on first view and commit it (DEF-C31); it must render the same defaults
    without storing them, and the first save creates the row."""
    from src.models.retention import RetentionPolicy

    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-view-shared", age_days=5, shared=True)
        await s.commit()

    async def policy_rows():
        async with session_factory() as s:
            return await s.scalar(select(func.count()).select_from(RetentionPolicy))

    _override_web_user(client.app)
    try:
        first = client.get("/app/settings")
        second = client.get("/app/settings")
        assert await policy_rows() == 0, "viewing the page must not create a policy"

        client.post("/app/settings", data={"keep_shared": "1"}, follow_redirects=False)
        assert await policy_rows() == 1, "the first save creates the row"
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    for resp in (first, second):
        assert resp.status_code == 200
        # The unsaved defaults are the stored defaults: switched off, shared
        # tasks kept, telemetry not purged.
        assert 'name="enabled" value="1" >' in resp.text
        assert 'name="keep_shared" value="1" checked>' in resp.text
        assert 'name="purge_telemetry" value="1" >' in resp.text


async def test_saving_settings_never_deletes(client, db_session, session_factory):
    """Arming a policy and running it are separate actions on purpose: switching
    retention on must not remove hundreds of conversations in the same click."""
    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-save", age_days=999)
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/settings",
            data={"enabled": "1", "max_age_days": "1", "keep_shared": "1"},
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    async with session_factory() as s:
        rows = await s.execute(select(Task.id))
        assert {r[0] for r in rows.all()} == {"r-save"}


async def test_run_now_applies_the_policy(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-run", age_days=200)
        await _make_task(s, "r-keep", age_days=1)
        await _policy(s, max_age_days=30, max_tasks=None)
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.post("/app/settings/run", follow_redirects=False)
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert "ran=1" in resp.headers["location"]
    async with session_factory() as s:
        rows = await s.execute(select(Task.id))
        assert {r[0] for r in rows.all()} == {"r-keep"}


async def test_blank_limits_disable_a_rule_rather_than_meaning_zero(
    client, db_session, session_factory
):
    """A fumbled entry must switch the rule off, not select every task."""
    from src.services.retention_service import get_policy, plan_sweep

    await _seed_user(db_session)
    async with session_factory() as s:
        await _make_task(s, "r-blank", age_days=5)
        await s.commit()

    _override_web_user(client.app)
    try:
        client.post(
            "/app/settings",
            data={"enabled": "1", "max_age_days": "", "max_tasks": "not a number"},
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    async with session_factory() as s:
        policy = await get_policy(s, "user_test")
        assert policy.max_age_days is None
        assert policy.max_tasks is None
        plan = await plan_sweep(s, "user_test", policy)

    assert plan.is_empty


async def test_retention_requires_a_session(client):
    for path in ("/app/settings",):
        resp = client.get(path, follow_redirects=False)
        assert resp.status_code == 303 and resp.headers["location"] == "/app/login"
    for path in ("/app/settings", "/app/settings/run"):
        resp = client.post(path, data={}, follow_redirects=False)
        assert resp.status_code == 303 and resp.headers["location"] == "/app/login"


async def test_saving_settings_persists_the_values(client, db_session, session_factory):
    """The form must actually round-trip. Every other retention test either
    asserts nothing was deleted or drives the service directly, so a form that
    silently saved all-falsy values would have gone unnoticed."""
    from src.services.retention_service import get_policy

    await _seed_user(db_session)

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/settings",
            data={
                "enabled": "1",
                "max_age_days": "45",
                "max_tasks": "250",
                "keep_shared": "1",
                "purge_telemetry": "1",
                "telemetry_max_age_days": "14",
            },
            follow_redirects=False,
        )
        page = client.get("/app/settings")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303

    async with session_factory() as s:
        policy = await get_policy(s, "user_test")

    assert policy.enabled is True
    assert policy.max_age_days == 45
    assert policy.max_tasks == 250
    assert policy.keep_shared is True
    assert policy.purge_telemetry is True
    assert policy.telemetry_max_age_days == 14

    # And the saved values come back on the page rather than only in the DB.
    assert 'value="45"' in page.text
    assert 'value="250"' in page.text
