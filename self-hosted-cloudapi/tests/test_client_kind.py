"""Which client sent a record (VS Code or the CLI): the rule, its stamping at
every ingest path, the task's client, and the metrics page filter.

The migration's backfill of the stored rows is tested in
tests/test_migration_drift.py, next to the other migration runs.
"""

import gzip
import hashlib
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from src.auth.web_session import get_web_user_optional
from src.dependencies import get_current_user
from src.models.error_report import ErrorReport
from src.models.event import TelemetryEvent
from src.models.llm_exchange import DatasetSettings, LlmExchange
from src.models.task import Task
from src.services.client_kind import client_kind_from, parse_client
from src.services.metrics_service import compute_user_metrics
from src.services.quality_overview import quality_overview
from src.services.telemetry_service import upsert_task_message

from tests.web_helpers import _llm_event, _override_current_user, _override_web_user, _seed_user

CLI_EDITOR = "wrapper|cli|cli|0.2.0"


# --- the rule ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields, expected",
    [
        ({"clientKind": "cli"}, "cli"),
        ({"clientKind": "vscode"}, "vscode"),
        ({"clientKind": " CLI "}, "cli"),
        # A known clientKind wins over the editor name.
        ({"clientKind": "vscode", "editorName": CLI_EDITOR}, "vscode"),
        # Old clients: the CLI's fake vscode module names itself.
        ({"editorName": CLI_EDITOR}, "cli"),
        ({"editorName": "Visual Studio Code"}, "vscode"),
        ({"editorName": "Cursor"}, "vscode"),
        # An unknown or broken clientKind falls back to the editor name.
        ({"clientKind": "jetbrains", "editorName": CLI_EDITOR}, "cli"),
        ({"clientKind": "jetbrains"}, "vscode"),
        ({"clientKind": 7, "editorName": "Visual Studio Code"}, "vscode"),
        ({"clientKind": None, "editorName": None}, "vscode"),
        ({}, "vscode"),
        (None, "vscode"),
        ("not a dict", "vscode"),
    ],
)
def test_client_kind_from(fields, expected):
    assert client_kind_from(fields) == expected


def test_parse_client_accepts_only_the_two_kinds():
    assert parse_client("cli") == "cli"
    assert parse_client("vscode") == "vscode"
    assert parse_client("CLI") is None
    assert parse_client("") is None
    assert parse_client(None) is None


# --- telemetry and tasks ----------------------------------------------------------


@pytest.fixture
def authed(client):
    _override_current_user(client.app)
    yield client
    client.app.dependency_overrides.pop(get_current_user, None)


def _event(client, props, event_type="LLM Completion"):
    resp = client.post("/api/events", json={"type": event_type, "properties": props})
    assert resp.status_code == 200
    return resp


async def _events(session_factory):
    async with session_factory() as s:
        rows = (await s.execute(select(TelemetryEvent.properties, TelemetryEvent.client_kind))).all()
    return {json.loads(props)["n"]: kind for props, kind in rows}


async def _task_client(session_factory, task_id):
    async with session_factory() as s:
        return await s.scalar(select(Task.client_kind).where(Task.id == task_id))


async def test_record_event_stamps_the_client(authed, db_session, session_factory):
    await _seed_user(db_session)

    _event(authed, {"n": 1, "clientKind": "cli", "clientVersion": "0.2.0"})
    _event(authed, {"n": 2, "clientKind": "vscode"})
    _event(authed, {"n": 3, "editorName": CLI_EDITOR})
    _event(authed, {"n": 4, "editorName": "Visual Studio Code"})
    _event(authed, {"n": 5})

    assert await _events(session_factory) == {1: "cli", 2: "vscode", 3: "cli", 4: "vscode", 5: "vscode"}


def _message(ts=1):
    return {"ts": ts, "type": "say", "say": "text", "text": "hello"}


async def test_a_bridge_task_turns_cli_with_its_first_cli_event(authed, db_session, session_factory):
    """The bridge creates the row from a message, which names no client."""
    await _seed_user(db_session)
    async with session_factory() as s:
        await upsert_task_message(s, "t-bridge", "user_test", _message())
        await s.commit()
    assert await _task_client(session_factory, "t-bridge") == "vscode"

    _event(authed, {"n": 1, "taskId": "t-bridge", "editorName": "Visual Studio Code"})
    assert await _task_client(session_factory, "t-bridge") == "vscode"

    _event(authed, {"n": 2, "taskId": "t-bridge", "clientKind": "cli"})
    assert await _task_client(session_factory, "t-bridge") == "cli"

    # Never back: a task lives in one client's storage only.
    _event(authed, {"n": 3, "taskId": "t-bridge", "clientKind": "vscode"})
    assert await _task_client(session_factory, "t-bridge") == "cli"


async def test_a_task_created_after_its_cli_events_is_the_clis(authed, db_session, session_factory):
    await _seed_user(db_session)
    _event(authed, {"n": 1, "taskId": "t-late", "editorName": CLI_EDITOR})

    async with session_factory() as s:
        await upsert_task_message(s, "t-late", "user_test", _message())
        await s.commit()

    assert await _task_client(session_factory, "t-late") == "cli"


async def test_another_users_cli_event_does_not_touch_the_task(authed, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    async with session_factory() as s:
        await upsert_task_message(s, "t-mine", "user_test", _message())
        s.add(TelemetryEvent(user_id="user_other", event_type="Task Created", task_id="t-late2", client_kind="cli"))
        await s.commit()
    _override_current_user(authed.app, user_id="user_other")

    _event(authed, {"n": 1, "taskId": "t-mine", "clientKind": "cli"})
    assert await _task_client(session_factory, "t-mine") == "vscode"

    # ...nor does it decide a new task of someone else.
    async with session_factory() as s:
        await upsert_task_message(s, "t-late2", "user_test", _message())
        await s.commit()
    assert await _task_client(session_factory, "t-late2") == "vscode"


def _backfill(client, task_id, properties):
    resp = client.post(
        "/api/events/backfill",
        files={"file": ("task.json", json.dumps([_message()]), "application/json")},
        data={"taskId": task_id, "properties": properties},
    )
    assert resp.status_code == 200


async def test_a_backfill_names_the_tasks_client(authed, db_session, session_factory):
    await _seed_user(db_session)

    _backfill(authed, "t-cli", json.dumps({"clientKind": "cli", "editorName": CLI_EDITOR}))
    _backfill(authed, "t-old-cli", json.dumps({"editorName": CLI_EDITOR}))
    _backfill(authed, "t-code", json.dumps({"editorName": "Visual Studio Code"}))
    _backfill(authed, "t-none", "{}")
    _backfill(authed, "t-broken", "{not json")

    assert await _task_client(session_factory, "t-cli") == "cli"
    assert await _task_client(session_factory, "t-old-cli") == "cli"
    assert await _task_client(session_factory, "t-code") == "vscode"
    assert await _task_client(session_factory, "t-none") == "vscode"
    assert await _task_client(session_factory, "t-broken") == "vscode"

    # A re-share of a task the bridge created first marks it too.
    async with session_factory() as s:
        await upsert_task_message(s, "t-reshare", "user_test", _message())
        await s.commit()
    _backfill(authed, "t-reshare", json.dumps({"clientKind": "cli"}))
    assert await _task_client(session_factory, "t-reshare") == "cli"


# --- error reports ----------------------------------------------------------------


def _report(report_id, **fields):
    return {
        "id": report_id,
        "occurredAt": 1790577835940,
        "category": "api_error",
        "summary": "Provider said no",
        **fields,
    }


async def test_error_reports_are_stamped_and_take_the_new_fields(authed, db_session, session_factory):
    await _seed_user(db_session)

    for body in (
        _report("r-cli", clientKind="cli", clientVersion="0.2.0", editorName=CLI_EDITOR),
        _report("r-old-cli", editorName=CLI_EDITOR),
        _report("r-code", clientKind="vscode", editorName="Visual Studio Code"),
        _report("r-none"),
        # An unknown value is stored, not refused: the editor name decides.
        _report("r-odd", clientKind="jetbrains", editorName=CLI_EDITOR),
    ):
        resp = authed.post("/api/error-reports", json=body)
        assert resp.status_code == 200, resp.text

    async with session_factory() as s:
        rows = {r.id: r for r in (await s.scalars(select(ErrorReport))).all()}
    assert {k: r.client_kind for k, r in rows.items()} == {
        "r-cli": "cli",
        "r-old-cli": "cli",
        "r-code": "vscode",
        "r-none": "vscode",
        "r-odd": "cli",
    }
    payload = json.loads(rows["r-cli"].payload)
    assert (payload["clientKind"], payload["clientVersion"]) == ("cli", "0.2.0")


# --- LLM exchanges ----------------------------------------------------------------


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _exchange(exchange_id, **fields):
    return {
        "id": exchange_id,
        "taskId": "task-1",
        "sequence": 0,
        "occurredAt": 1790000000000,
        "retryAttempt": 0,
        "modelId": "glm-5.3",
        "request": {
            "system": {"sha256": _sha("sys"), "text": "sys"},
            "tools": {"sha256": _sha("[]"), "text": "[]"},
            "messages": {"keep": 0, "append": [{"role": "user", "content": "hi"}]},
            "messageCount": 1,
            "params": {},
        },
        "response": {"text": "hello"},
        "status": "completed",
        **fields,
    }


async def test_llm_exchanges_are_stamped_and_take_the_new_fields(authed, db_session, session_factory):
    await _seed_user(db_session)
    db_session.add(DatasetSettings(user_id="user_test", recording_enabled=True))
    await db_session.commit()

    for body in (
        _exchange("ex-cli", clientKind="cli", clientVersion="0.2.0"),
        _exchange("ex-old-cli", editorName=CLI_EDITOR),
        _exchange("ex-code", clientKind="vscode"),
        _exchange("ex-odd", clientKind="something-new"),
    ):
        resp = authed.post(
            "/api/llm-exchanges",
            content=gzip.compress(json.dumps(body).encode()),
            headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
        )
        assert resp.json()["stored"] is True, resp.text

    async with session_factory() as s:
        rows = {r.id: r.client_kind for r in (await s.scalars(select(LlmExchange))).all()}
    assert rows == {"ex-cli": "cli", "ex-old-cli": "cli", "ex-code": "vscode", "ex-odd": "vscode"}


# --- the metrics page -------------------------------------------------------------


async def _seed_two_clients(db_session):
    await _seed_user(db_session)
    db_session.add_all(
        [
            _llm_event(model="code-model", task_id="t-code", tin=1000, tout=0, cost=0.5),
            _llm_event(model="code-model", task_id="t-code", tin=1000, tout=0, cost=0.5),
            _llm_event(model="cli-model", task_id="t-cli", tin=300, tout=0, cost=0.25, client_kind="cli"),
            TelemetryEvent(
                user_id="user_test",
                event_type="Embedding Usage",
                client_kind="cli",
                properties=json.dumps({"promptTokens": 70, "source": "index-scan"}),
                created_at=datetime.now(timezone.utc),
            ),
            Task(id="t-code", user_id="user_test", title="Code run", q_requests=1, q_errors=3),
            Task(id="t-cli", user_id="user_test", title="CLI run", client_kind="cli", q_requests=1, q_errors=4),
        ]
    )
    await db_session.commit()


async def test_metrics_filter_and_break_down_by_client(db_session):
    await _seed_two_clients(db_session)

    both = await compute_user_metrics(db_session, "user_test", period="all")
    assert both["totals"]["completions"] == 3
    assert [(r["name"], r["label"], r["tokens"], r["count"]) for r in both["by_client"]] == [
        ("vscode", "VS Code", 2000, 2),
        ("cli", "CLI", 300, 1),
    ]
    assert both["embeddings"]["tokens"] == 70

    cli = await compute_user_metrics(db_session, "user_test", period="all", client="cli")
    assert cli["totals"]["completions"] == 1
    assert [r["name"] for r in cli["by_model"]] == ["cli-model"]
    assert [r["name"] for r in cli["by_client"]] == ["cli"]
    assert cli["embeddings"]["tokens"] == 70

    code = await compute_user_metrics(db_session, "user_test", period="all", client="vscode")
    assert code["totals"]["completions"] == 2
    assert code["embeddings"]["has_data"] is False


async def test_quality_overview_follows_the_client_filter(db_session):
    await _seed_two_clients(db_session)

    assert (await quality_overview(db_session, "user_test", "all"))["total"] == 2
    cli = await quality_overview(db_session, "user_test", "all", "cli")
    assert cli["total"] == 1
    assert [r["title"] for r in cli["roughest"]] == ["CLI run"]


async def test_metrics_page_client_filter_keeps_itself_on_every_link(client, db_session):
    await _seed_two_clients(db_session)
    _override_web_user(client.app)
    try:
        body = client.get("/app/metrics?period=30d&client=cli").text
        everything = client.get("/app/metrics?period=30d").text
        bogus = client.get("/app/metrics?period=30d&client=nonsense").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    # The filter picks the CLI's figures and marks its option.
    assert "cli-model" in body and "code-model" not in body
    assert 'period-opt active" href="/app/metrics?period=30d&amp;client=cli">CLI<' in body
    # The period links carry the client; the client links carry the period.
    assert 'href="/app/metrics?period=7d&amp;client=cli"' in body
    assert 'href="/app/metrics?period=30d&amp;client=vscode">VS Code<' in body
    assert 'href="/app/metrics?period=30d">All clients<' in body
    # The breakdown names the clients the way the filter does.
    assert "By client" in everything
    assert ">VS Code</td>" in everything and ">CLI</td>" in everything
    # No filter: both, with "All clients" active; an unknown value is no filter.
    assert 'period-opt active" href="/app/metrics?period=30d">All clients<' in everything
    assert "cli-model" in bogus and "code-model" in bogus
