"""The "Client" filter (VS Code or the CLI) on the problem report, the task
list, the task page and the dataset page.

The column and its stamping are tested in tests/test_client_kind.py; here the
rows are seeded with their client_kind directly.
"""

import gzip
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from html import unescape

from src.auth.web_session import get_web_user_optional
from src.dependencies import get_current_user
from src.models.error_report import ErrorReport
from src.models.event import TelemetryEvent
from src.models.llm_exchange import DatasetSettings
from src.models.task import Task
from src.services.diagnostics_service import (
    SOURCE_CONVERSATION,
    SOURCE_REPORT,
    Occurrence,
    ProblemFilter,
    aggregate_problems,
    compute_user_problems,
)
from src.services.problem_catalogue import problem_signature
from tests.test_web_diagnostics import MISSING_PATH, _add_message, _request, _say_error
from tests.web_helpers import _llm_event, _override_current_user, _override_web_user, _seed_user

BASE = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
BASE_MS = int(BASE.timestamp() * 1000)
NAN = 'Error reading artifact: The value of "size" is out of range. Received NaN'


def _get(http, url, **params):
    _override_web_user(http.app)
    try:
        return http.get(url, params=params or None)
    finally:
        http.app.dependency_overrides.pop(get_web_user_optional, None)


# --- the problem report: the pure filter ------------------------------------------


def _occ(text, client, *, task="t1", source=SOURCE_REPORT):
    return Occurrence(source=source, category="invalid_tool_call", tool="apply_diff", text=text, when=BASE,
                      task_id=task, model="glm", provider="openai", client=client)


def test_problem_filter_parses_and_labels_the_client():
    assert ProblemFilter.parse({"client": "cli"}).client == "cli"
    assert ProblemFilter.parse({"client": "vscode"}).label("client") == "VS Code"
    assert ProblemFilter.parse({"client": "emacs"}).client == ""
    f = ProblemFilter.parse({"client": "cli"})
    assert f.active and f.label("client") == "CLI"
    assert f.describe() == "client 'CLI'"
    assert f.without("client").active is False


def test_the_client_filter_narrows_problems_and_offers_both_clients():
    occurrences = [_occ(MISSING_PATH, "vscode", task=f"v{i}") for i in range(3)] + [_occ(MISSING_PATH, "cli", task="c1")]
    cli = aggregate_problems(occurrences, Counter(), "7d", None, ProblemFilter(period="7d", client="cli"))
    assert (cli["total"], cli["tasks"]) == (1, 1)
    # The options come from the unfiltered period, in the fixed order.
    assert cli["options"]["client"] == [
        {"value": "vscode", "label": "VS Code", "count": 3},
        {"value": "cli", "label": "CLI", "count": 1},
    ]
    both = aggregate_problems(occurrences, Counter(), "7d", None, ProblemFilter(period="7d"))
    assert both["total"] == 4


# --- the problem report: collection and the page ----------------------------------


def _report(report_id, client, *, summary=MISSING_PATH, category="invalid_tool_call", tool="apply_diff"):
    stamp = datetime.now(timezone.utc)
    return ErrorReport(
        id=report_id, user_id="user_test", category=category, tool_name=tool, summary=summary,
        model_id="glm", provider="openai", mode="code", task_id=f"task-{report_id}", client_kind=client,
        signature=problem_signature(category, tool, summary), occurred_at=stamp, created_at=stamp,
        payload=json.dumps({"summary": summary}),
    )


async def test_every_source_carries_its_client(db_session):
    """Reports and events their own column, conversation errors their task's."""
    await _seed_user(db_session)
    db_session.add_all(
        [
            Task(id="t-cli", user_id="user_test", client_kind="cli"),
            Task(id="t-code", user_id="user_test"),
            TelemetryEvent(user_id="user_test", event_type="Exception", client_kind="cli",
                           properties=json.dumps({"errorName": "TypeError", "errorMessage": "boom"}),
                           created_at=BASE),
            TelemetryEvent(user_id="user_test", event_type="Exception",
                           properties=json.dumps({"errorName": "TypeError", "errorMessage": "bang"}),
                           created_at=BASE),
        ]
    )
    await db_session.commit()
    for task_id in ("t-cli", "t-code"):
        await _add_message(db_session, task_id, _request(BASE_MS + 1, 100, 10))
        await _add_message(db_session, task_id, _say_error(BASE_MS + 2, MISSING_PATH))
    await db_session.commit()

    legacy = await compute_user_problems(db_session, "user_test", period="all")
    assert legacy["options"]["client"] == [
        {"value": "vscode", "label": "VS Code", "count": 2},
        {"value": "cli", "label": "CLI", "count": 2},
    ]
    cli = await compute_user_problems(db_session, "user_test", filters=ProblemFilter(period="all", client="cli"))
    assert cli["total"] == 2
    assert cli["sources"] == {SOURCE_CONVERSATION: 1, "telemetry": 1}

    # Reports carry their own client. (The legacy rows above predate the
    # first report, so they still count.)
    db_session.add_all([_report("r-cli", "cli"), _report("r-code", "vscode")])
    await db_session.commit()
    reported = await compute_user_problems(db_session, "user_test", filters=ProblemFilter(period="all", client="cli"))
    assert reported["sources"] == {SOURCE_REPORT: 1, SOURCE_CONVERSATION: 1, "telemetry": 1}
    assert [r["id"] for g in reported["groups"] for r in g["reports"]] == ["r-cli"]



async def test_the_model_fit_counts_requests_of_the_filtered_client(db_session):
    await _seed_user(db_session)
    db_session.add_all(
        [
            _report("r-cli", "cli"),
            _llm_event(model="glm", provider="openai", client_kind="cli"),
            _llm_event(model="glm", provider="openai"),
            _llm_event(model="glm", provider="openai"),
        ]
    )
    await db_session.commit()

    def requests(problems):
        return {row["model"]: row["requests"] for row in problems["model_fit"]}

    assert requests(await compute_user_problems(db_session, "user_test", period="7d")) == {"glm": 3}
    cli = await compute_user_problems(db_session, "user_test", filters=ProblemFilter(period="7d", client="cli"))
    assert requests(cli) == {"glm": 1}


async def test_the_diagnostics_page_filters_by_client_with_a_chip(client, db_session):
    await _seed_user(db_session)
    db_session.add_all(
        [
            _report("r-cli", "cli"),
            _report("r-code", "vscode", summary=NAN, category="tool_error", tool="read_artifact"),
        ]
    )
    await db_session.commit()

    body = _get(client, "/app/diagnostics", period="all", client="cli").text
    assert body.count('<summary class="diag-row">') == 1
    assert "Tool call without a required parameter" in body
    assert "Client: <b>CLI</b>" in body
    assert 'class="filter-chip" href="/app/diagnostics?period=all"' in body
    assert '<select name="client">' in body
    assert '<option value="cli" selected>CLI (1)</option>' in body
    # The period tabs and the brief links keep it.
    assert 'href="/app/diagnostics?period=7d&amp;client=cli"' in body
    assert "/app/diagnostics/report.md?period=all&amp;client=cli" in body

    brief = _get(client, "/app/diagnostics/report.md", period="all", client="cli").text
    assert "Filters: client 'CLI'." in brief
    assert "from the CLI" in brief
    assert "read_artifact computed a NaN size" not in brief

    # An unknown value is no filter, never an error.
    bogus = _get(client, "/app/diagnostics", period="all", client="vim")
    assert bogus.status_code == 200 and bogus.text.count('<summary class="diag-row">') == 2


# --- the task list and the task page ----------------------------------------------


async def _seed_tasks(session_factory):
    async with session_factory() as s:
        s.add_all(
            [
                Task(id="code-1", user_id="user_test", title="Code one", updated_at=BASE),
                Task(id="cli-1", user_id="user_test", title="CLI one", client_kind="cli",
                     updated_at=BASE - timedelta(minutes=1)),
            ]
        )
        await s.commit()


def _order(html):
    return re.findall(r'name="task_ids" value="([^"]+)"', html)


async def test_the_task_list_filters_by_client(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory)

    assert _order(_get(client, "/app").text) == ["code-1", "cli-1"]
    assert _order(_get(client, "/app", client="cli").text) == ["cli-1"]
    assert _order(_get(client, "/app", client="vscode").text) == ["code-1"]
    assert _order(_get(client, "/app", client="emacs").text) == ["code-1", "cli-1"]


async def test_the_task_list_marks_cli_rows_and_shows_the_filter(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory)

    html = _get(client, "/app", client="cli", sort="cost", dir="asc").text
    # Only the CLI row gets a badge; VS Code is the default and stays quiet.
    assert html.count('class="badge badge-client"') == 1
    form = html[html.index('id="filter-form"'):]
    form = form[:form.index("</form>")]
    assert '<select name="client">' in form
    assert '<option value="cli" selected>CLI</option>' in form
    chips = re.findall(r'<a class="filter-chip" href="([^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL)
    assert [(unescape(href), re.sub(r"<[^>]+>|\s+", "", label)) for href, label in chips] == [
        ("/app?scope=roots&sort=cost&dir=asc", "Client:CLI✕")
    ]
    plain = _get(client, "/app").text
    assert plain.count('class="badge badge-client"') == 1


async def test_bulk_delete_keeps_the_client_filter(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory)

    _override_web_user(client.app)
    try:
        page = client.get("/app", params={"client": "cli"}).text
        form = page[page.index('id="bulk-form"'):]
        hidden = dict(re.findall(r'<input type="hidden" name="(\w+)" value="([^"]*)"', form[:form.index("<ul")]))
        assert hidden == {"scope": "roots", "client": "cli"}
        resp = client.post(
            "/app/tasks/bulk-delete", data={"task_ids": ["cli-1"], **hidden}, follow_redirects=False
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.headers["location"] == "/app?scope=roots&client=cli"


async def test_the_task_page_names_its_client(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory)

    assert "Client: CLI" in _get(client, "/app/tasks/cli-1").text
    assert "Client: VS Code" in _get(client, "/app/tasks/code-1").text


# --- the dataset page ---------------------------------------------------------------


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _exchange(exchange_id, task_id, model, **fields):
    return {
        "id": exchange_id,
        "taskId": task_id,
        "sequence": 0,
        "occurredAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "retryAttempt": 0,
        "modelId": model,
        "request": {
            "system": {"sha256": _sha("sys"), "text": "sys"},
            "tools": {"sha256": _sha("[]"), "text": "[]"},
            "messages": {"keep": 0, "append": [{"role": "user", "content": "hi"}]},
            "messageCount": 1,
            "params": {},
        },
        "response": {"text": f"answer from {model}"},
        "status": "completed",
        **fields,
    }


async def _record_two_clients(client, db_session):
    await _seed_user(db_session)
    db_session.add(DatasetSettings(user_id="user_test", recording_enabled=True))
    await db_session.commit()
    _override_current_user(client.app)
    try:
        for body in (
            _exchange("ex-code", "task-code", "code-model", clientKind="vscode"),
            _exchange("ex-cli", "task-cli", "cli-model", clientKind="cli"),
        ):
            resp = client.post(
                "/api/llm-exchanges",
                content=gzip.compress(json.dumps(body).encode()),
                headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
            )
            assert resp.json()["stored"] is True
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)


async def test_the_dataset_page_and_export_filter_by_client(client, db_session):
    await _record_two_clients(client, db_session)

    page = _get(client, "/app/dataset", client="cli").text
    assert "cli-model" in page and "code-model" not in page
    assert 'period-opt active" href="/app/dataset?period=all&amp;client=cli"' in page
    assert 'href="/app/dataset?period=7d&amp;client=cli"' in page
    assert '<input type="hidden" name="client" value="cli">' in page
    everything = _get(client, "/app/dataset").text
    assert "cli-model" in everything and "code-model" in everything
    assert 'name="client"' not in everything

    def exported(**params):
        resp = _get(client, "/app/dataset/export.jsonl", anonymize="0", metadata="1", **params)
        assert resp.status_code == 200
        return sorted(json.loads(line)["metadata"]["model"] for line in resp.text.splitlines() if line.strip())

    assert exported() == ["cli-model", "code-model"]
    assert exported(client="cli") == ["cli-model"]
    assert exported(client="vscode") == ["code-model"]
    assert exported(client="nonsense") == ["cli-model", "code-model"]
