"""POST /api/error-reports: the contract, storage, duplicates, retention, deletion."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from src.dependencies import get_current_user
from src.models.error_report import ErrorReport
from src.models.task import Task
from src.models.user import User
from src.services.retention_service import apply_sweep, get_policy, plan_sweep
from src.services.share_service import delete_tasks

from tests.web_helpers import _override_current_user, _seed_user

NOW_MS = 1790577835940


def _report(**overrides):
    """A report shaped exactly as the extension sends it."""
    body = {
        "id": "7f9c2a3e-1d4b-4c8e-9f00-aa11bb22cc33",
        "occurredAt": NOW_MS,
        "category": "invalid_tool_call",
        "summary": "Roo tried to use apply_diff without value for required parameter 'path'. Retrying...",
        "errorMessage": "Missing value for required parameter 'path'.",
        "taskId": "task-1",
        "mode": "code",
        "appVersion": "1.0.0",
        "editorName": "Visual Studio Code",
        "platform": "linux",
        "provider": "openai",
        "modelId": "GLM-5.3-Flash-NVFP4",
        "contextWindow": 262144,
        "maxOutputTokens": 32768,
        "contextTokens": 131072,
        "messageCount": 42,
        "toolName": "apply_diff",
        "httpStatus": 200,
        "retryAttempt": 1,
        "request": {
            "systemPromptChars": 48211,
            "systemPromptSha256": "ab" * 32,
            "toolNames": ["read_file", "apply_diff"],
            "params": {"temperature": 0.2},
            "messages": [
                {"role": "user", "content": "Fix the bug in src/a.ts"},
                {"role": "assistant", "content": "Reading the file."},
            ],
        },
        "response": {
            "text": "",
            "reasoning": "I will edit the file.",
            "toolCalls": [{"id": "call_1", "name": "apply_diff", "arguments": '{"diff": "<<<<<<< SEARCH"}'}],
            "stopReason": "tool_calls",
            "usage": {"inputTokens": 131072, "outputTokens": 120},
        },
        "toolResult": "Missing value for required parameter 'path'.",
    }
    body.update(overrides)
    return body


@pytest.fixture
def authed(client):
    _override_current_user(client.app)
    yield client
    client.app.dependency_overrides.pop(get_current_user, None)


async def _reports(session_factory):
    async with session_factory() as s:
        return list((await s.scalars(select(ErrorReport))).all())


# --- the endpoint --------------------------------------------------------------


def test_a_report_needs_the_bearer_token(client):
    assert client.post("/api/error-reports", json=_report()).status_code == 401
    bad = client.post("/api/error-reports", json=_report(), headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


async def test_a_session_token_is_accepted_like_on_the_events_endpoint(client, db_session, session_factory):
    from src.auth.jwt_issuer import issue_session_token

    await _seed_user(db_session)
    token = issue_session_token("user_test", None)

    resp = client.post("/api/error-reports", json=_report(), headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    [row] = await _reports(session_factory)
    assert row.user_id == "user_test"


async def test_a_report_is_stored_with_its_columns_and_payload(authed, db_session, session_factory):
    await _seed_user(db_session)

    resp = authed.post("/api/error-reports", json=_report())

    assert resp.status_code == 200
    assert resp.json() == {"success": True}
    [row] = await _reports(session_factory)
    assert row.user_id == "user_test"
    assert (row.category, row.tool_name, row.model_id, row.provider, row.mode, row.task_id) == (
        "invalid_tool_call", "apply_diff", "GLM-5.3-Flash-NVFP4", "openai", "code", "task-1",
    )
    assert row.signature == (
        "invalid_tool_call | apply_diff | "
        "Roo tried to use apply_diff without value for required parameter 'path'. Retrying..."
    )
    occurred = row.occurred_at if row.occurred_at.tzinfo else row.occurred_at.replace(tzinfo=timezone.utc)
    assert occurred == datetime.fromtimestamp(NOW_MS / 1000, tz=timezone.utc)
    payload = json.loads(row.payload)
    assert payload["request"]["messages"][1] == {"role": "assistant", "content": "Reading the file."}
    assert payload["response"]["toolCalls"][0]["arguments"] == '{"diff": "<<<<<<< SEARCH"}'


async def test_only_the_four_required_fields_are_required(authed, db_session, session_factory):
    await _seed_user(db_session)
    minimal = {"id": "r-min", "occurredAt": NOW_MS, "category": "api_error", "summary": "Connection error."}

    assert authed.post("/api/error-reports", json=minimal).status_code == 200

    [row] = await _reports(session_factory)
    assert (row.model_id, row.task_id, row.tool_name) == (None, None, None)
    # Absent fields are not written as null.
    assert json.loads(row.payload) == minimal


async def test_a_duplicate_id_is_a_success_without_a_second_row(authed, db_session, session_factory):
    await _seed_user(db_session)

    first = authed.post("/api/error-reports", json=_report())
    again = authed.post("/api/error-reports", json=_report(summary="a retried copy"))

    assert first.status_code == again.status_code == 200
    assert again.json() == {"success": True}
    [row] = await _reports(session_factory)
    assert row.summary.startswith("Roo tried to use apply_diff")


async def test_unknown_fields_are_ignored_and_unknown_categories_kept(authed, db_session, session_factory):
    await _seed_user(db_session)
    body = _report(category="quota_exhausted", futureField={"x": 1})
    body["response"]["futureNested"] = True

    assert authed.post("/api/error-reports", json=body).status_code == 200

    [row] = await _reports(session_factory)
    assert row.category == "quota_exhausted"
    payload = json.loads(row.payload)
    assert "futureField" not in payload
    assert "futureNested" not in payload["response"]


@pytest.mark.parametrize(
    "change",
    [
        {"summary": None},
        {"summary": "x" * 501},
        {"errorMessage": "x" * 8001},
        {"toolResult": "x" * 8001},
        {"occurredAt": "yesterday"},
        {"occurredAt": -1},
        {"category": ""},
        {"id": ""},
        {"request": {"messages": [{"role": "robot", "content": "hi"}]}},
        {"response": {"toolCalls": [{"arguments": "{}"}]}},
        {"contextWindow": "big"},
    ],
)
async def test_a_report_outside_the_contract_is_refused(authed, db_session, session_factory, change):
    await _seed_user(db_session)
    body = _report()
    for key, value in change.items():
        if value is None:
            body.pop(key)
        else:
            body[key] = value

    resp = authed.post("/api/error-reports", json=body)

    assert resp.status_code == 422
    assert await _reports(session_factory) == []


async def test_a_body_that_is_not_json_is_refused(authed, db_session):
    await _seed_user(db_session)
    resp = authed.post("/api/error-reports", content=b"{not json", headers={"content-type": "application/json"})
    assert resp.status_code == 422


async def test_a_body_over_a_megabyte_is_refused_with_413(authed, db_session, session_factory):
    await _seed_user(db_session)
    body = json.dumps(_report(response={"text": "x" * (1024 * 1024)})).encode()

    resp = authed.post("/api/error-reports", content=body, headers={"content-type": "application/json"})

    assert resp.status_code == 413
    assert await _reports(session_factory) == []


async def test_nothing_is_stored_when_the_deployment_takes_no_telemetry(authed, db_session, session_factory, monkeypatch):
    from config.settings import settings

    await _seed_user(db_session)
    monkeypatch.setattr(settings, "telemetry_enabled", False)

    resp = authed.post("/api/error-reports", json=_report())

    assert resp.status_code == 200 and resp.json()["success"] is True
    assert await _reports(session_factory) == []


# --- retention and deletion ----------------------------------------------------


def _row(report_id, user_id="user_test", task_id=None, created_at=None):
    stamp = created_at or datetime.now(timezone.utc)
    return ErrorReport(
        id=report_id,
        user_id=user_id,
        task_id=task_id,
        category="api_error",
        summary="Connection error.",
        signature="api_error | - | Connection error.",
        occurred_at=stamp,
        created_at=stamp,
        payload='{"summary": "Connection error."}',
    )


async def test_the_telemetry_sweep_takes_old_reports_and_counts_them(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            _row("old", created_at=now - timedelta(days=40)),
            _row("new", created_at=now - timedelta(days=2)),
            _row("theirs", user_id="user_other", created_at=now - timedelta(days=40)),
        ]
    )
    await db_session.commit()
    policy = await get_policy(db_session, "user_test")
    policy.enabled = True
    policy.purge_telemetry = True
    policy.telemetry_max_age_days = 30

    plan = await plan_sweep(db_session, "user_test", policy, now=now)
    assert (plan.report_count, plan.event_count) == (1, 1)
    assert plan.event_bytes > 0

    await apply_sweep(db_session, "user_test", policy, plan=plan, now=now)
    await db_session.commit()

    left = set((await db_session.scalars(select(ErrorReport.id))).all())
    assert left == {"new", "theirs"}
    assert policy.last_deleted_events == 1


async def test_no_report_is_swept_while_telemetry_purging_is_off(db_session):
    await _seed_user(db_session)
    now = datetime.now(timezone.utc)
    db_session.add(_row("old", created_at=now - timedelta(days=400)))
    await db_session.commit()
    policy = await get_policy(db_session, "user_test")
    policy.enabled = True
    policy.max_age_days = 1

    plan = await plan_sweep(db_session, "user_test", policy, now=now)

    assert plan.report_count == 0


async def test_deleting_a_task_deletes_its_reports(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    db_session.add(Task(id="t1", user_id="user_test"))
    await db_session.commit()
    db_session.add_all(
        [
            _row("in-task", task_id="t1"),
            _row("elsewhere", task_id="t2"),
            # Another account naming the same task id keeps its report.
            _row("theirs", user_id="user_other", task_id="t1"),
        ]
    )
    await db_session.commit()

    assert await delete_tasks(db_session, ["t1"], "user_test") == 1
    await db_session.commit()

    left = set((await db_session.scalars(select(ErrorReport.id))).all())
    assert left == {"elsewhere", "theirs"}


async def test_deleting_a_user_deletes_their_reports(db_session):
    await _seed_user(db_session)
    db_session.add(_row("mine"))
    await db_session.commit()

    user = await db_session.get(User, "user_test")
    await db_session.delete(user)
    await db_session.commit()

    assert await db_session.scalar(select(func.count(ErrorReport.id))) == 0
