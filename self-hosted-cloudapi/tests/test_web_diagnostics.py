"""The diagnostics page (/app/diagnostics): errors and feature usage."""

import json
from datetime import datetime, timedelta, timezone

from src.auth.web_session import get_web_user_optional
from src.models.event import TelemetryEvent
from src.services.diagnostics_service import (
    NOT_RECORDED,
    aggregate_diagnostics,
    compute_user_diagnostics,
    error_signature,
)

from tests.web_helpers import _llm_event, _override_web_user, _seed_user

BASE = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

# What every event carries from the provider, before its own properties.
APP = {"appName": "tumble-code", "appVersion": "1.0.0", "platform": "linux", "mode": "code"}


def _event(event_type, user_id="user_test", created_at=BASE, **props):
    return TelemetryEvent(
        user_id=user_id,
        organization_id=None,
        event_type=event_type,
        task_id=props.get("taskId"),
        properties=json.dumps({**APP, **props}),
        created_at=created_at,
    )


def _rows(*events):
    return [(e.event_type, e.properties, e.created_at) for e in events]


# --- grouping ------------------------------------------------------------------


def test_error_signature_names_where_and_what():
    assert error_signature({"location": "scanner:parse", "error": "boom\nat x"}) == "scanner:parse · boom"
    assert (
        error_signature({"errorName": "ApiProviderError", "provider": "zai", "errorMessage": "429"})
        == "ApiProviderError · zai · 429"
    )
    assert error_signature({"schemaName": "providerProfiles"}) == "providerProfiles"
    # No message of its own: grouped by the task's model instead.
    assert error_signature({**APP, "taskId": "t", "modelId": "glm-5.3"}) == "glm-5.3"
    # An event from before the extension sent its own properties.
    assert error_signature(APP) == ""


def test_errors_group_by_type_and_signature_with_digits_blanked():
    d = aggregate_diagnostics(
        _rows(
            _event("Code Index Error", location="embed", error="HTTP 500 after 3 tries"),
            _event("Code Index Error", location="embed", error="HTTP 500 after 4 tries",
                   created_at=BASE + timedelta(minutes=5)),
            _event("Code Index Error", location="watcher", error="ENOENT"),
            _event("Code Index Error"),
            _event("Code Index Error"),
        ),
        "all",
    )

    errors = d["errors"]
    assert errors["total"] == 5
    assert errors["by_type"] == [{"event": "Code Index Error", "label": "Code index", "count": 5}]
    by_sig = {g["sample"]["signature"]: g for g in errors["groups"]}
    assert set(by_sig) == {"embed · HTTP 500 after 4 tries", "watcher · ENOENT", NOT_RECORDED}
    embed = by_sig["embed · HTTP 500 after 4 tries"]
    assert embed["count"] == 2
    # The latest occurrence is the sample, and the span covers both.
    assert embed["first_seen"] == "2026-10-01 12:00"
    assert embed["last_seen"] == "2026-10-01 12:05"
    assert errors["undetailed"] == 2
    # Newest first.
    assert errors["recent"][0]["signature"] == NOT_RECORDED


def test_exception_detail_carries_message_stack_and_task():
    d = aggregate_diagnostics(
        _rows(
            _event("Exception", errorName="ApiProviderError", errorMessage="rate limited",
                   stack="ApiProviderError: rate limited\n    at f", provider="zai",
                   modelId="glm-5.3", taskId="t1"),
        ),
        "all",
    )

    sample = d["errors"]["groups"][0]["sample"]
    assert sample["label"] == "Exception"
    assert sample["message"] == "rate limited"
    assert sample["stack"].startswith("ApiProviderError")
    assert (sample["provider"], sample["model"], sample["task_id"], sample["version"]) == (
        "zai", "glm-5.3", "t1", "1.0.0",
    )


def test_usage_counts_tools_and_features_by_their_dimension():
    d = aggregate_diagnostics(
        _rows(
            _event("Tool Used", taskId="t", tool="read_file"),
            _event("Tool Used", taskId="t", tool="read_file"),
            _event("Tool Used", taskId="t", tool="apply_diff"),
            _event("Tool Used", taskId="t"),
            _event("Mode Switched", taskId="t", newMode="architect"),
            _event("Checkpoint Created", taskId="t"),
            _event("Checkpoint Created", taskId="t"),
        ),
        "all",
    )

    usage = d["usage"]
    assert d["errors"]["total"] == 0
    assert usage["total"] == 7
    assert usage["tool_total"] == 4
    assert usage["tools"] == [
        {"name": "read_file", "count": 2},
        {"name": NOT_RECORDED, "count": 1},
        {"name": "apply_diff", "count": 1},
    ]
    assert (usage["tools_named"], usage["tools_unnamed"]) == (2, 1)
    features = {f["event"]: f for f in usage["features"]}
    assert features["Checkpoint Created"]["count"] == 2
    assert features["Checkpoint Created"]["breakdown"] == []
    assert features["Mode Switched"]["breakdown"] == [{"name": "architect", "count": 1}]


def test_long_breakdowns_fold_the_tail_into_one_row():
    events = [_event("Tab Shown", tab=f"tab-{i:02d}") for i in range(13)]
    breakdown = aggregate_diagnostics(_rows(*events), "all")["usage"]["features"][0]["breakdown"]
    assert len(breakdown) == 11
    assert breakdown[-1] == {"name": "3 more", "count": 3}


def test_undecodable_payloads_are_skipped():
    rows = [("Tool Used", "not json", BASE), ("Tool Used", json.dumps([1]), BASE)]
    assert aggregate_diagnostics(rows, "all")["has_data"] is False


# --- the query -----------------------------------------------------------------


async def test_compute_reads_only_this_users_diagnostic_events_in_the_period(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            _event("Tool Used", tool="read_file", created_at=now),
            _event("Code Index Error", location="embed", error="boom", created_at=now),
            # Older than the 7-day default.
            _event("Tool Used", tool="old_tool", created_at=now - timedelta(days=30)),
            # Another user's.
            _event("Tool Used", user_id="user_other", tool="theirs", created_at=now),
            # Not diagnostics at all.
            _llm_event(created_at=now),
            _event("Task Message", taskId="t", created_at=now),
        ]
    )
    await db_session.commit()

    d = await compute_user_diagnostics(db_session, "user_test")

    assert d["period"] == "7d"
    assert d["usage"]["tools"] == [{"name": "read_file", "count": 1}]
    assert d["usage"]["total"] == 1
    assert d["errors"]["total"] == 1

    everything = await compute_user_diagnostics(db_session, "user_test", period="all")
    assert {t["name"] for t in everything["usage"]["tools"]} == {"read_file", "old_tool"}
    # An unknown period falls back to the default rather than failing.
    assert (await compute_user_diagnostics(db_session, "user_test", period="nope"))["period"] == "7d"


# --- the page ------------------------------------------------------------------


async def test_diagnostics_redirects_to_login_without_session(client):
    resp = client.get("/app/diagnostics", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_diagnostics_page_renders_errors_and_usage(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add_all(
            [
                _event("Exception", errorName="ApiProviderError", errorMessage="rate <limited>",
                       stack="ApiProviderError: at f", provider="zai", taskId="t1"),
                _event("Tool Used", tool="apply_diff"),
            ]
        )
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app/diagnostics?period=all")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'href="/app/diagnostics" class="active" aria-current="page"' in body
    assert "ApiProviderError · zai · rate &lt;limited&gt;" in body
    assert 'href="/app/tasks/t1"' in body
    assert "apply_diff" in body


async def test_diagnostics_page_empty_state(client, db_session):
    await _seed_user(db_session)
    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app/diagnostics")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "No errors or feature events recorded for this period." in resp.text
