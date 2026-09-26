"""CPU-bound pure work runs in a worker thread, not on the event loop (CAPI-M12).

Each test swaps the pure function for a wrapper that records whether an event
loop is running in the thread that calls it. A worker thread started by
``anyio.to_thread.run_sync`` has none; the loop thread always has one. This
proves where the work runs without relying on timings.
"""

import asyncio
import json
import threading

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.task import Task
from tests.web_helpers import (
    _add_message,
    _backfill_files,
    _llm_event,
    _msgs,
    _override_current_user,
    _override_web_user,
    _seed_user,
    _summarize,
)


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _spy(monkeypatch, module, name):
    """Replace ``module.name`` with a pass-through that records its callers' threads."""
    calls = []
    real = getattr(module, name)

    def _wrapper(*args, **kwargs):
        calls.append({"on_loop": _on_event_loop(), "thread": threading.get_ident()})
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, _wrapper)
    return calls


@pytest.fixture
def web_user(client):
    _override_web_user(client.app)
    yield
    client.app.dependency_overrides.pop(get_web_user_optional, None)


async def _seed_task(session_factory, task_id="task-offload"):
    async with session_factory() as s:
        s.add(Task(id=task_id, user_id="user_test", title="Offload"))
        await s.flush()
        for message in _msgs():
            await _add_message(s, task_id, message)
        await _summarize(s, task_id)
        await s.commit()


async def test_backfill_upload_is_parsed_off_the_loop(client, db_session, monkeypatch):
    from src.routers import events

    calls = _spy(monkeypatch, events, "_parse_backfill_upload")
    await _seed_user(db_session)
    _override_current_user(client.app)
    files, data = _backfill_files("task-parse", _msgs())

    resp = client.post("/api/events/backfill", files=files, data=data)

    assert resp.status_code == 200
    assert len(calls) == 1
    assert calls[0]["on_loop"] is False


def test_backfill_upload_parser_keeps_its_answers():
    from src.routers.events import _parse_backfill_upload

    assert _parse_backfill_upload(json.dumps(_msgs()).encode()) == _msgs()
    assert _parse_backfill_upload(b"not json") == []
    assert _parse_backfill_upload(b"\xff\xfe") == []


async def test_metrics_aggregation_runs_off_the_loop(db_session, monkeypatch):
    from src.services import metrics_service

    calls = _spy(monkeypatch, metrics_service, "aggregate_user_metrics")
    await _seed_user(db_session)
    db_session.add(_llm_event())
    await db_session.commit()

    result = await metrics_service.compute_user_metrics(db_session, "user_test", period="all")

    assert result["totals"]["completions"] == 1
    assert len(calls) == 1
    assert calls[0]["on_loop"] is False
    assert calls[0]["thread"] != threading.get_ident()


async def test_task_page_parses_and_serializes_the_conversation_off_the_loop(
    client, db_session, session_factory, monkeypatch, web_user
):
    from src.web.presenters import task_detail

    parses = _spy(monkeypatch, task_detail, "_parse_messages")
    dumps = _spy(monkeypatch, task_detail, "_conversation_json")
    await _seed_user(db_session)
    await _seed_task(session_factory)

    resp = client.get("/app/tasks/task-offload")

    assert resp.status_code == 200
    assert "Build me a feature" in resp.text
    assert [c["on_loop"] for c in parses] == [False]
    assert [c["on_loop"] for c in dumps] == [False]


async def test_shared_page_parses_and_serializes_the_conversation_off_the_loop(
    client, db_session, session_factory, monkeypatch, web_user
):
    from src.models.task import TaskShare
    from src.web.presenters import task_detail

    parses = _spy(monkeypatch, task_detail, "_parse_messages")
    dumps = _spy(monkeypatch, task_detail, "_conversation_json")
    await _seed_user(db_session)
    await _seed_task(session_factory, "task-shared-offload")
    async with session_factory() as s:
        s.add(
            TaskShare(
                task_id="task-shared-offload",
                visibility="public",
                share_url="http://testserver/shared/task-shared-offload",
            )
        )
        await s.commit()

    resp = client.get("/shared/task-shared-offload")

    assert resp.status_code == 200
    assert "Build me a feature" in resp.text
    assert [c["on_loop"] for c in parses] == [False]
    assert [c["on_loop"] for c in dumps] == [False]
