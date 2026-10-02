"""The dataset export and the dataset page, on the extension's own contract fixture.

The fixture task (tests/fixtures/llm_exchanges_recorder.json): exchange 0 reads
a file (clean), 1 fails with a 502, 2 reads a missing file (tool failed),
3 is lost in upload, 4 completes the task. The workspace is
/home/alice/work/acme-portal and a file holds an OpenAI-style key.
"""

import gzip
import json
from pathlib import Path

import pytest

from src.auth.web_session import get_web_user_optional
from src.dependencies import get_current_user
from src.models.llm_exchange import DatasetSettings
from src.models.user import User

from tests.web_helpers import _override_current_user, _override_web_user

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "llm_exchanges_recorder.json").read_text())
IDS = [item["body"]["id"] for item in FIXTURE["exchanges"]]


def _post(client, path, body):
    data = gzip.compress(json.dumps(body).encode())
    return client.post(path, content=data, headers={"Content-Type": "application/json", "Content-Encoding": "gzip"})


@pytest.fixture
async def recorded(client, db_session):
    db_session.add(User(id="user_test", authentik_id="ak_user_test", email="alice@acme.com",
                        first_name="Alice", last_name="Smith"))
    await db_session.commit()
    db_session.add(DatasetSettings(user_id="user_test", recording_enabled=True, anonymize_terms="Globex"))
    await db_session.commit()
    _override_current_user(client.app)
    for item in FIXTURE["exchanges"]:
        if item["accepted"]:
            _post(client, "/api/llm-exchanges", item["body"])
    for outcome in FIXTURE["outcomes"]:
        _post(client, "/api/llm-exchanges/outcome", outcome)
    client.app.dependency_overrides.pop(get_current_user, None)
    _override_web_user(client.app, email="alice@acme.com")
    yield client
    client.app.dependency_overrides.pop(get_web_user_optional, None)


def _export(client, **params):
    resp = client.get("/app/dataset/export.jsonl", params=params)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


def test_turns_hold_one_sample_per_clean_answer(recorded):
    samples = _export(recorded, anonymize="0", metadata="1")

    # 0 and 4 are clean; 1 failed and 2 ran a failing tool (kept by default, so 3 samples).
    assert [s["metadata"]["exchange"] for s in samples] == [IDS[0], IDS[2], IDS[4]]
    first = samples[0]
    assert first["messages"][0]["role"] == "system"
    assert first["messages"][0]["content"] == FIXTURE["expected"][0]["system"]
    assert first["tools"] == FIXTURE["expected"][0]["tools"]
    target = first["messages"][-1]
    # The answer exactly as streamed: raw arguments, reasoning, weight 1.
    assert target == {
        "role": "assistant",
        "content": "Reading the login code.",
        "reasoning_content": "The bug is probably in login.ts.",
        "tool_calls": [{"id": "call_1", "type": "function", "function": {
            "name": "read_file", "arguments": '{"path": "/home/alice/work/acme-portal/src/login.ts"}'}}],
        "weight": 1,
    }
    last = samples[-1]["messages"]
    roles = [m["role"] for m in last]
    assert roles == ["system", "user", "assistant", "tool", "user", "assistant", "tool", "assistant"]
    assert [m.get("weight") for m in last if m["role"] == "assistant"] == [0, 0, 1]
    tool_message = last[3]
    assert tool_message == {"role": "tool", "tool_call_id": "call_1", "content": "[Old tool result content cleared]"}


def test_strict_leaves_out_the_failing_tool_and_reasoning_can_be_left_out(recorded):
    samples = _export(recorded, anonymize="0", metadata="1", strict="1", reasoning="0")

    assert [s["metadata"]["exchange"] for s in samples] == [IDS[0], IDS[4]]
    assert "reasoning_content" not in samples[0]["messages"][-1]
    assert "metadata" not in _export(recorded, anonymize="0")[0]


def test_filters_by_model_workspace_and_limit(recorded):
    assert _export(recorded, model="another-model") == []
    assert _export(recorded, exclude_workspace="/home/alice/work/acme-portal") == []
    assert len(_export(recorded, limit="1")) == 1
    assert len(_export(recorded, model="glm-5.3")) == 3


def test_trajectories_train_on_the_clean_answers_of_one_run(recorded):
    samples = _export(recorded, format="trajectories", anonymize="0", metadata="1")

    # 0 -> 2 extend each other; the microcompact in 4 starts a new run.
    assert [s["metadata"]["exchanges"] for s in samples] == [[IDS[0], IDS[2]], [IDS[4]]]
    first = samples[0]["messages"]
    assistants = [m for m in first if m["role"] == "assistant"]
    assert [m["weight"] for m in assistants] == [1, 1]
    # The earlier answer is the exact one (raw arguments), not the history's re-serialization.
    assert assistants[0]["tool_calls"][0]["function"]["arguments"] == '{"path": "/home/alice/work/acme-portal/src/login.ts"}'
    assert first[-1]["role"] == "assistant"

    strict = _export(recorded, format="trajectories", anonymize="0", metadata="1", strict="1")
    assert [s["metadata"]["trained"] for s in strict] == [[IDS[0]], [IDS[4]]]
    # The failing call stays out of training: the run ends at the last clean answer.
    assert strict[0]["messages"][-1]["tool_calls"][0]["id"] == "call_1"


def test_the_export_is_anonymized_by_default(recorded):
    text = "\n".join(json.dumps(s, ensure_ascii=False) for s in _export(recorded))

    for leaked in ("alice", "Alice", "acme-portal", "sk-proj-", "/home/alice", "alice@acme.com"):
        assert leaked not in text, leaked
    assert "/workspace/project1/src/login.ts" in text
    assert "[REDACTED_SECRET]" in text
    assert "Home Directory: /home/user" in text


def test_the_audit_lists_the_replacements(recorded):
    resp = recorded.get("/app/dataset/audit", params={"format": "turns"})

    assert resp.status_code == 200
    assert "Anonymization audit" in resp.text
    assert "/home/alice/work/acme-portal" in resp.text
    assert "/workspace/project1" in resp.text
    assert "3 samples from 1 task" in resp.text


def test_the_task_report_reconstructs_every_request(recorded):
    resp = recorded.get("/app/dataset/tasks/task-contract.jsonl")

    assert resp.status_code == 200
    lines = [json.loads(line) for line in resp.text.splitlines()]
    assert [line["id"] for line in lines] == [IDS[0], IDS[1], IDS[2], IDS[4]]
    assert all(line["wire"]["verified"] is True for line in lines)
    assert lines[0]["request"]["messages"] == FIXTURE["expected"][0]["messages"]
    # Not anonymized: this is the owner's exact record.
    assert "/home/alice/work/acme-portal" in resp.text
    assert recorded.get("/app/dataset/tasks/nope.jsonl").status_code == 404


def test_the_page_counts_and_offers_the_export(recorded):
    resp = recorded.get("/app/dataset")

    assert resp.status_code == 200
    body = resp.text
    assert 'aria-current="page">Dataset</a>' in body
    assert "glm-5.3" in body
    assert "/home/alice/work/acme-portal" in body
    assert "/app/dataset/tasks/task-contract.jsonl" in body
    assert "The request failed" in body  # the api_error issue row


async def test_the_switch_and_the_terms_are_saved(recorded, session_factory):
    resp = recorded.post("/app/dataset/settings", data={"terms": " Globex \n\nInitech\n"}, follow_redirects=False)

    assert resp.status_code == 303
    async with session_factory() as s:
        row = await s.get(DatasetSettings, "user_test")
    assert (row.recording_enabled, row.anonymize_terms) == (False, "Globex\nInitech")


def test_delete_all_recordings(recorded):
    resp = recorded.post("/app/dataset/delete", follow_redirects=False)

    assert resp.headers["location"] == "/app/dataset?deleted=4"
    assert _export(recorded) == []
    assert "Nothing recorded" in recorded.get("/app/dataset").text
