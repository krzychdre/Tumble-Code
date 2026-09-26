"""POST /api/events/backfill refuses an upload above BACKFILL_MAX_BYTES (CAPI-M12).

The route used to read the whole upload into memory, however large, and parse
it on the event loop. It now answers 413 above the cap: straight from the
declared Content-Length before a byte of the body is read, and, for a body sent
without a length (chunked), as soon as the running count passes the cap.

The default (50 MiB) is about five times the largest real upload: the largest
of the owner's 1212 stored conversations (ui_messages.json, which the extension
uploads as ``JSON.stringify(messages)``) is 10 046 249 bytes.
"""

import json

import httpx
import pytest

from config.settings import Settings, settings
from tests.web_helpers import _backfill_files, _override_current_user, _seed_user

LIMIT = 4096


def _big_messages(size: int) -> list[dict]:
    return [{"ts": 1, "type": "say", "say": "text", "text": "x" * size}]


def _multipart(task_id: str, messages: list[dict]) -> tuple[bytes, str]:
    """The exact multipart body and content type the test client would send."""
    files, data = _backfill_files(task_id, messages)
    request = httpx.Request("POST", "http://testserver/api/events/backfill", files=files, data=data)
    return request.read(), request.headers["content-type"]


@pytest.fixture
def small_cap(monkeypatch):
    monkeypatch.setattr(settings, "backfill_max_bytes", LIMIT)


@pytest.fixture
def no_backfill(monkeypatch):
    """Fail loudly if an oversize upload still reaches the write path."""
    calls = []

    async def _record(**kwargs):
        calls.append(kwargs)

    from src.routers import events

    monkeypatch.setattr(events, "backfill_messages", _record)
    return calls


def test_default_cap_is_50_mib():
    assert Settings.model_fields["backfill_max_bytes"].default == 50 * 1024 * 1024


async def test_upload_under_the_cap_is_stored(client, db_session, small_cap):
    await _seed_user(db_session)
    _override_current_user(client.app)
    files, data = _backfill_files("task-small", _big_messages(100))
    resp = client.post("/api/events/backfill", files=files, data=data)
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_declared_length_over_the_cap_is_413(client, db_session, small_cap, no_backfill):
    await _seed_user(db_session)
    _override_current_user(client.app)
    files, data = _backfill_files("task-big", _big_messages(LIMIT * 2))
    resp = client.post("/api/events/backfill", files=files, data=data)
    assert resp.status_code == 413
    assert no_backfill == []


async def test_declared_length_over_the_cap_is_refused_before_reading_the_body(
    client, db_session, small_cap, no_backfill
):
    """The Content-Length check happens before the body is touched at all."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    body, content_type = _multipart("task-big", _big_messages(LIMIT * 2))

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/events/backfill",
        "raw_path": b"/api/events/backfill",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", content_type.encode()),
            (b"content-length", str(len(body)).encode()),
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    body_reads = 0

    async def receive():
        nonlocal body_reads
        body_reads += 1
        return {"type": "http.request", "body": body, "more_body": False}

    sent = []

    async def send(message):
        sent.append(message)

    await client.app(scope, receive, send)

    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 413
    assert body_reads == 0
    assert no_backfill == []


async def test_streamed_body_over_the_cap_is_413(client, db_session, small_cap, no_backfill):
    """No Content-Length (chunked upload): the bytes are counted as they arrive."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    body, content_type = _multipart("task-big", _big_messages(LIMIT * 2))

    def _chunks():
        for i in range(0, len(body), 1024):
            yield body[i : i + 1024]

    resp = client.post(
        "/api/events/backfill",
        content=_chunks(),
        headers={"content-type": content_type},
    )
    assert resp.status_code == 413
    assert no_backfill == []


async def test_streamed_body_under_the_cap_is_stored(client, db_session, small_cap):
    await _seed_user(db_session)
    _override_current_user(client.app)
    messages = _big_messages(100)
    body, content_type = _multipart("task-streamed", messages)
    assert len(body) < LIMIT

    resp = client.post(
        "/api/events/backfill",
        content=iter([body]),
        headers={"content-type": content_type},
    )
    assert resp.status_code == 200

    from sqlalchemy import select

    from src.models.task import TaskMessage

    rows = (
        await db_session.execute(
            select(TaskMessage.message_data).where(TaskMessage.task_id == "task-streamed")
        )
    ).all()
    assert [json.loads(r[0]) for r in rows] == messages

