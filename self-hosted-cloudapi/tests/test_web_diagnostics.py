"""The problem report (/app/diagnostics): sources, grouping, model fit, pages, export."""

import json
from collections import Counter
from datetime import datetime, timedelta, timezone

from src.auth.web_session import get_web_user_optional
from src.models.error_report import ErrorReport
from src.models.event import TelemetryEvent
from src.models.task import Task
from src.services.diagnostics_service import (
    SOURCE_CONVERSATION,
    SOURCE_REPORT,
    UNKNOWN_MODEL,
    Occurrence,
    compute_user_problems,
    conversation_category,
    conversation_occurrences,
    group_occurrences,
    ProblemFilter,
    model_fit,
    telemetry_occurrence,
)
from src.services.model_attribution import Completion
from src.services.problem_brief import problem_brief_markdown, render_brief
from src.services.problem_catalogue import MODEL, problem_signature

from src.models.task import TaskMessage
from src.services.session_quality import classify_message
from src.services.task_summary import message_metrics
from tests.web_helpers import _llm_event, _override_web_user, _seed_user

BASE = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
BASE_MS = int(BASE.timestamp() * 1000)
MISSING_PATH = "Roo tried to use apply_diff without value for required parameter 'path'. Retrying..."


def _occ(text, *, category="invalid_tool_call", tool="apply_diff", task="t1", model="glm", provider="openai",
         when=BASE, source=SOURCE_REPORT, report_id=None):
    return Occurrence(source=source, category=category, tool=tool, text=text, when=when, task_id=task,
                      model=model, provider=provider, report_id=report_id)


def _report_row(report_id, *, user_id="user_test", created_at=None, payload=None, **cols):
    stamp = created_at or datetime.now(timezone.utc)
    body = payload or {"summary": cols.get("summary", MISSING_PATH)}
    values = {
        "category": "invalid_tool_call",
        "tool_name": "apply_diff",
        "summary": MISSING_PATH,
        "model_id": "GLM-5.3-Flash-NVFP4",
        "provider": "openai",
        "mode": "code",
        "task_id": "task-r",
        **cols,
    }
    values["signature"] = problem_signature(values["category"], values["tool_name"], values["summary"])
    return ErrorReport(
        id=report_id, user_id=user_id, occurred_at=stamp, created_at=stamp, payload=json.dumps(body), **values
    )


async def _add_message(session, task_id, message):
    """A stored message with its quality marker, as the write path stores it.

    tests/web_helpers._add_message leaves ``q_kind`` empty; the problem report
    finds error messages by it.
    """
    session.add(
        TaskMessage(
            task_id=task_id,
            message_data=json.dumps(message),
            message_ts=message.get("ts"),
            q_kind=classify_message(message, awaiting_completion=False),
            **message_metrics(message).as_columns(),
        )
    )


def _request(ts, tin, tout):
    return {"ts": ts, "type": "say", "say": "api_req_started", "text": json.dumps({"tokensIn": tin, "tokensOut": tout})}


def _say_error(ts, text, say="error"):
    return {"ts": ts, "type": "say", "say": say, "text": text}


# --- the conversation source ---------------------------------------------------


def test_conversation_messages_map_to_categories_and_tools():
    cases = [
        (_say_error(1, MISSING_PATH), ("invalid_tool_call", "apply_diff")),
        (_say_error(1, "MODEL_NO_ASSISTANT_MESSAGES"), ("empty_response", None)),
        (_say_error(1, "Error reading file a.ts: ENOENT"), ("tool_error", "read_file")),
        (_say_error(1, "Error listing files:\nCannot list files"), ("tool_error", "list_files")),
        (_say_error(1, "Error executing MCP tool:\nMCP error -32001"), ("tool_error", "use_mcp_tool")),
        (_say_error(1, "web_fetch got HTTP 403 for x"), ("tool_error", "web_fetch")),
        (_say_error(1, 'Artifact not found: "x"'), ("tool_error", "read_artifact")),
        (_say_error(1, "Something new"), ("tool_error", None)),
        (_say_error(1, "<error_details>", say="diff_error"), ("diff_error", "apply_diff")),
        (_say_error(1, "pattern", say="rooignore_error"), ("rooignore", None)),
        (_say_error(1, "maximum context length is 1 tokens", say="api_req_retry_delayed"), ("context_overflow", None)),
        (_say_error(1, "did not provide any assistant messages", say="api_req_retry_delayed"), ("empty_response", None)),
        (_say_error(1, "Connection error.", say="api_req_retry_delayed"), ("api_error", None)),
        ({"ts": 1, "type": "ask", "ask": "mistake_limit_reached", "text": "x"}, ("mistake_limit", None)),
    ]
    for message, expected in cases:
        assert conversation_category(message) == expected, message


def test_an_error_takes_the_model_of_the_request_before_it():
    rows = [
        ("t", 150, json.dumps(_say_error(150, MISSING_PATH)), BASE),
        ("t", 250, json.dumps(_say_error(250, "MODEL_NO_ASSISTANT_MESSAGES")), BASE),
        # Before any request: nothing to attribute it to in a two-model task.
        ("t", 50, json.dumps(_say_error(50, "Something odd")), BASE),
    ]
    requests = {"t": [(100, (1000, 10)), (200, (2000, 20)), (300, (0, 0))]}
    completions = {
        "t": [
            Completion(model="glm", mode="code", input_tokens=1000, output_tokens=10, provider="openai"),
            Completion(model="qwen", mode="code", input_tokens=2000, output_tokens=20, provider="lmstudio"),
        ]
    }

    occurrences = conversation_occurrences(rows, requests, completions)

    by_ts = {int(o.when.timestamp() * 1000): o for o in occurrences}
    assert (by_ts[150].model, by_ts[150].provider, by_ts[150].tool) == ("glm", "openai", "apply_diff")
    assert (by_ts[250].model, by_ts[250].category) == ("qwen", "empty_response")
    assert by_ts[50].model is None
    assert all(o.source == SOURCE_CONVERSATION for o in occurrences)


def test_a_one_model_task_attributes_every_error():
    rows = [("t", 150, json.dumps(_say_error(150, "boom")), BASE)]
    requests = {"t": [(100, (5, 5))]}
    completions = {"t": [Completion(model="glm", mode=None, input_tokens=1, output_tokens=1)]}
    assert conversation_occurrences(rows, requests, completions)[0].model == "glm"


def test_telemetry_events_become_occurrences_with_their_detail():
    detailed = telemetry_occurrence(
        "Exception",
        json.dumps({"errorName": "TypeError", "errorMessage": "x is undefined", "modelId": "glm", "apiProvider": "zai"}),
        BASE,
        "t1",
    )
    assert (detailed.category, detailed.model, detailed.provider, detailed.task_id) == ("exception", "glm", "zai", "t1")
    assert detailed.text == "TypeError x is undefined"

    bare = telemetry_occurrence("Code Index Error", json.dumps({"appVersion": "1.0.0"}), BASE, None)
    assert (bare.category, bare.text) == ("code_index", "Code index")
    assert telemetry_occurrence("Code Index Error", "not json", BASE, None) is None


# --- grouping and model fit ------------------------------------------------------


def test_occurrences_group_by_signature_and_rank_by_reach():
    occurrences = [
        _occ(MISSING_PATH, task=f"t{i}", when=BASE + timedelta(minutes=i)) for i in range(3)
    ] + [
        # Many, but all in one task: ranked below the one that hit three.
        _occ("MODEL_NO_ASSISTANT_MESSAGES", category="empty_response", tool=None, task="t9") for _ in range(10)
    ] + [
        _occ("Error reading file a/b.ts: ENOENT", category="tool_error", tool="read_file", task="t1"),
        _occ("Error reading file c.md: ENOENT", category="tool_error", tool="read_file", task="t2", model=None),
    ]

    groups = group_occurrences(occurrences)

    assert [g["rule"] for g in groups] == ["missing_tool_parameter", "path_guessed", "empty_response"]
    first = groups[0]
    assert (first["count"], first["tasks"], first["classification"]) == (3, 3, MODEL)
    assert first["first_seen"] == "2026-10-01 12:00" and first["last_seen"] == "2026-10-01 12:02"
    assert "glm called apply_diff" in first["mitigation"]
    paths = groups[1]
    assert paths["count"] == 2
    assert {(m["model"], m["count"]) for m in paths["models"]} == {("glm", 1), (UNKNOWN_MODEL, 1)}


def test_task_less_problems_count_one_per_day_of_reach():
    burst = [_occ("Code index", category="code_index", tool=None, task=None, when=BASE + timedelta(seconds=i))
             for i in range(200)]
    spread = [_occ(MISSING_PATH, task=f"t{i}") for i in range(2)]
    groups = group_occurrences(burst + spread)
    assert [g["rule"] for g in groups] == ["missing_tool_parameter", "code_index"]
    assert groups[1]["reach"] == 1 and groups[1]["count"] == 200


def test_model_fit_counts_requests_problems_and_the_rate():
    occurrences = [_occ(MISSING_PATH, task=f"t{i}") for i in range(3)] + [
        _occ("MODEL_NO_ASSISTANT_MESSAGES", category="empty_response", tool=None, model="qwen", provider="lmstudio"),
        # No provider recorded: folded into glm's only provider.
        _occ(MISSING_PATH, provider=None),
        _occ("Odd", category="tool_error", tool=None, model=None, provider=None),
        # Not the chat model's: left out of the table.
        _occ("Code index", category="code_index", tool=None, model=None, provider="openai"),
    ]
    requests = Counter({("openai", "glm"): 200, ("lmstudio", "qwen"): 10, ("anthropic", "claude"): 50})
    rows = {(r["provider"], r["model"]): r for r in model_fit(occurrences, group_occurrences(occurrences), requests)}

    assert rows[("openai", "glm")]["problems"] == 4
    assert rows[("openai", "glm")]["requests"] == 200
    assert rows[("openai", "glm")]["per_100"] == 2.0
    assert rows[("openai", "glm")]["top_category"] == "invalid_tool_call"
    assert rows[("openai", "glm")]["top_class"] == MODEL
    assert rows[("lmstudio", "qwen")]["per_100"] == 10.0
    assert rows[("anthropic", "claude")]["problems"] == 0
    assert rows[("", UNKNOWN_MODEL)]["per_100"] is None
    assert rows[("", UNKNOWN_MODEL)]["problems"] == 1
    assert ("openai", UNKNOWN_MODEL) not in rows


# --- reading the database --------------------------------------------------------


async def _seed_conversation(session, task_id="task-c", user_id="user_test", start_ms=None):
    start_ms = start_ms or int(datetime.now(timezone.utc).timestamp() * 1000) - 60_000
    session.add(Task(id=task_id, user_id=user_id))
    await session.commit()
    await _add_message(session, task_id, _request(start_ms, 1000, 10))
    await _add_message(session, task_id, _say_error(start_ms + 1000, MISSING_PATH))
    session.add(_llm_event(user_id=user_id, task_id=task_id, model="GLM-5.3-Flash-NVFP4", provider="openai",
                           tin=1000, tout=10))
    await session.commit()


async def test_the_page_reads_conversations_and_telemetry_of_this_user_only(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    await _seed_conversation(db_session)
    await _seed_conversation(db_session, task_id="task-o", user_id="user_other")
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            TelemetryEvent(user_id="user_test", event_type="Code Index Error", properties="{}", created_at=now),
            # Outside the 7-day default.
            TelemetryEvent(user_id="user_test", event_type="Code Index Error", properties="{}",
                           created_at=now - timedelta(days=30)),
        ]
    )
    await db_session.commit()

    p = await compute_user_problems(db_session, "user_test")

    assert p["period"] == "7d"
    assert p["total"] == 2
    rules = {g["rule"]: g for g in p["groups"]}
    assert set(rules) == {"missing_tool_parameter", "code_index"}
    assert rules["missing_tool_parameter"]["models"] == [
        {"provider": "openai", "model": "GLM-5.3-Flash-NVFP4", "count": 1}
    ]
    fit = {r["model"]: r for r in p["model_fit"]}
    assert fit["GLM-5.3-Flash-NVFP4"]["requests"] == 1
    assert fit["GLM-5.3-Flash-NVFP4"]["per_100"] == 100.0

    everything = await compute_user_problems(db_session, "user_test", period="all")
    assert everything["total"] == 3
    assert (await compute_user_problems(db_session, "user_test", period="nope"))["period"] == "7d"


async def test_legacy_sources_stop_at_the_first_error_report(db_session):
    await _seed_user(db_session)
    now = datetime.now(timezone.utc)
    # A conversation error two days ago, then reports from yesterday on.
    await _seed_conversation(db_session, start_ms=int((now - timedelta(days=2)).timestamp() * 1000))
    await _add_message(db_session, "task-c", _say_error(int((now - timedelta(hours=1)).timestamp() * 1000),
                                                        "Error reading file a.ts: ENOENT"))
    db_session.add(TelemetryEvent(user_id="user_test", event_type="Exception", properties="{}",
                                  created_at=now - timedelta(hours=2)))
    db_session.add(_report_row("r1", created_at=now - timedelta(days=1)))
    await db_session.commit()

    p = await compute_user_problems(db_session, "user_test")

    # The old error, and the report; the later conversation error and the
    # later exception are the report's era, so they are not read twice.
    assert p["sources"] == {"report": 1, "conversation": 1}
    assert p["legacy_until"] is not None


async def test_the_list_does_not_read_report_payloads(db_session):
    """The payload column is not selected for the list (only the drill-down and
    the export read it): a payload that is not even JSON changes nothing."""
    await _seed_user(db_session)
    row = _report_row("r1")
    row.payload = "not json at all"
    db_session.add(row)
    await db_session.commit()

    p = await compute_user_problems(db_session, "user_test")

    assert p["groups"][0]["reports"][0]["id"] == "r1"


# --- the pages -------------------------------------------------------------------


def _get(client, url, user_id="user_test"):
    from src.main import app

    _override_web_user(app, user_id=user_id)
    try:
        return client.get(url)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)


async def test_diagnostics_redirects_to_login_without_session(client):
    resp = client.get("/app/diagnostics", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_the_page_lists_classified_problems_escaped(client, db_session):
    await _seed_user(db_session)
    db_session.add(_report_row("r1", summary="Roo tried to use <script>x</script> without value for required parameter 'path'",
                               tool_name="<b>tool</b>"))
    await db_session.commit()

    resp = _get(client, "/app/diagnostics?period=all")

    assert resp.status_code == 200
    body = resp.text
    assert 'href="/app/diagnostics" class="active" aria-current="page"' in body
    assert "Problem report" in body
    assert "Tool call without a required parameter" in body
    assert "Model mismatch" in body
    assert "&lt;script&gt;" in body and "<script>x" not in body
    assert "&lt;b&gt;tool&lt;/b&gt;" in body
    assert 'href="/app/diagnostics/reports/r1"' in body
    assert 'href="/app/diagnostics/report.md?period=all"' in body
    assert 'id="table-model-fit"' in body


async def test_diagnostics_page_empty_state(client, db_session):
    await _seed_user(db_session)
    resp = _get(client, "/app/diagnostics")
    assert resp.status_code == 200
    assert "No problems recorded for this period." in resp.text


async def test_a_report_opens_in_full_for_its_owner(client, db_session):
    await _seed_user(db_session)
    payload = {
        "summary": MISSING_PATH,
        "errorMessage": "Missing value <for> 'path'",
        "contextWindow": 200000,
        "contextTokens": 50000,
        "httpStatus": 200,
        "request": {
            "systemPromptChars": 48211,
            "systemPromptSha256": "ab" * 32,
            "toolNames": ["read_file", "apply_diff"],
            "messages": [{"role": "user", "content": "Fix <the> bug"}],
        },
        "response": {
            "text": "ok",
            "reasoning": "thinking hard",
            "toolCalls": [{"id": "c1", "name": "apply_diff", "arguments": '{"diff": "<<<<<<< SEARCH"}'}],
            "stopReason": "tool_calls",
        },
        "toolResult": "the tool said <no>",
    }
    db_session.add(_report_row("r1", payload=payload, task_id="task-r"))
    await db_session.commit()

    resp = _get(client, "/app/diagnostics/reports/r1")

    assert resp.status_code == 200
    body = resp.text
    assert "GLM-5.3-Flash-NVFP4" in body
    assert "50,000 tokens (25.0%)" in body
    assert "200,000" in body
    assert "48,211 characters" in body
    assert "Fix &lt;the&gt; bug" in body
    assert "&#34;diff&#34;: &#34;&lt;&lt;&lt;&lt;&lt;&lt;&lt; SEARCH&#34;" in body or "&lt;&lt;&lt;&lt;&lt;&lt;&lt; SEARCH" in body
    assert "tool_calls" in body
    assert "the tool said &lt;no&gt;" in body
    assert 'href="/app/tasks/task-r"' in body


async def test_someone_elses_report_is_not_found(client, db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    db_session.add(_report_row("theirs", user_id="user_other"))
    await db_session.commit()

    resp = _get(client, "/app/diagnostics/reports/theirs")
    missing = _get(client, "/app/diagnostics/reports/nope")

    assert resp.status_code == missing.status_code == 404
    assert "Report not found" in resp.text
    assert resp.text == missing.text


async def test_the_markdown_export_has_a_sample_per_group(client, db_session):
    await _seed_user(db_session)
    await _seed_conversation(db_session)
    db_session.add(
        _report_row(
            "r1",
            summary="The language model did not provide any assistant messages",
            category="empty_response",
            tool_name=None,
            payload={
                "summary": "The language model did not provide any assistant messages",
                "request": {"messages": [{"role": "user", "content": "Do it ``` now"}]},
                "response": {"text": "", "stopReason": "length", "errorBody": "x" * 3000},
            },
        )
    )
    await db_session.commit()

    resp = _get(client, "/app/diagnostics/report.md?period=30d")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    assert "attachment" in resp.headers["content-disposition"]
    text = resp.text
    assert text.startswith("# Tumble Code problem report")
    assert "Period: 30 days." in text
    assert "## Model fit" in text
    assert "Model returned no answer (Model mismatch)" in text
    assert "Tool call without a required parameter (Model mismatch)" in text
    assert "Mitigation:" in text
    # The request's last message, fenced past the backticks inside it.
    assert "````\nDo it ``` now\n````" in text
    assert "Response stop reason: `length`" in text
    assert "more characters cut]" in text
    # The legacy group's sample is its message text.
    assert MISSING_PATH in text


def test_the_markdown_of_an_empty_period_says_so():
    problems = {"period_label": "7 days", "total": 0, "groups": [], "hidden_groups": 0, "tasks": 0,
                "by_class": [], "legacy_until": None, "model_fit": [], "has_data": False, "filtered": False,
                "period_total": 0, "sources": {}}
    text = render_brief(problems, ProblemFilter(), {"reports": {}, "context": {}}, BASE)
    assert "No problems recorded in this period." in text


async def test_the_export_needs_a_session(client):
    resp = client.get("/app/diagnostics/report.md", follow_redirects=False)
    assert resp.status_code == 303


async def test_problem_report_markdown_falls_back_to_the_default_period(db_session):
    await _seed_user(db_session)
    text = await problem_brief_markdown(db_session, "user_test", ProblemFilter.parse({"period": "nope"}))
    assert "Period: 7 days." in text
