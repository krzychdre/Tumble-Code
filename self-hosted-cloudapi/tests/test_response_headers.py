"""Headers built from what a client chose, and the panel's Referrer-Policy.

- A download's name comes from a client-chosen task id; it must not be able
  to close the quoted filename, add parameters, carry CR/LF, or fail the
  response on a character a header cannot hold.
- A panel page (a public share above all) shows images from any https: host
  and links anywhere; no other origin may be told the page's address.
"""

import copy
import gzip
import json
import re
from pathlib import Path
from urllib.parse import quote, unquote

import pytest

from src.auth.web_session import get_web_user_optional
from src.dependencies import get_current_user
from src.models.llm_exchange import DatasetSettings
from src.models.task import Task, TaskShare
from src.utils.content_disposition import attachment

from tests.web_helpers import (
    _add_message,
    _msgs,
    _override_current_user,
    _override_web_user,
    _seed_user,
    _summarize,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "llm_exchanges_recorder.json").read_text()
)
_TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")


def _parse(header: str) -> dict:
    """The parameters of a Content-Disposition value (quoted strings unquoted)."""
    disposition, _, rest = header.partition(";")
    params = {"": disposition.strip()}
    for match in re.finditer(r'\s*([^=;\s]+)=("([^"\\]*)"|[^;]*)\s*(;|$)', rest):
        name, raw, quoted = match.group(1), match.group(2), match.group(3)
        params[name.lower()] = quoted if quoted is not None else raw
    return params


@pytest.mark.parametrize(
    "name",
    [
        "tumble-exchanges-plain.jsonl",
        'evil"; filename="x.exe.jsonl',
        "line\r\nSet-Cookie: a=b.jsonl",
        "za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105 ja\u017a\u0144.jsonl",
        "..\\..\\x.jsonl",
    ],
)
def test_the_header_carries_the_name_and_nothing_else(name):
    header = attachment(name)

    header.encode("latin-1")  # a header can hold it
    assert "\r" not in header and "\n" not in header
    params = _parse(header)
    assert set(params) == {"", "filename", "filename*"}
    assert params[""] == "attachment"
    assert re.fullmatch(r"[A-Za-z0-9._-]+", params["filename"])
    assert not params["filename"].startswith(".")
    charset, _, encoded = params["filename*"].partition("''")
    assert charset == "UTF-8" and _TOKEN.fullmatch(encoded)
    assert unquote(encoded) == name


async def test_a_task_report_of_an_odd_task_id_downloads_safely(client, db_session):
    task_id = 'odd"; filename="evil.exe \u0105'
    await _seed_user(db_session)
    db_session.add(DatasetSettings(user_id="user_test", recording_enabled=True))
    await db_session.commit()
    body = copy.deepcopy(FIXTURE["exchanges"][0]["body"])
    body["taskId"] = task_id
    _override_current_user(client.app)
    try:
        stored = client.post(
            "/api/llm-exchanges",
            content=gzip.compress(json.dumps(body).encode()),
            headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
        )
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)
    assert stored.json()["stored"] is True

    _override_web_user(client.app)
    try:
        resp = client.get(f"/app/dataset/tasks/{quote(task_id, safe='')}.jsonl")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    params = _parse(resp.headers["content-disposition"])
    assert set(params) == {"", "filename", "filename*"}
    assert unquote(params["filename*"].partition("''")[2]) == (
        f"tumble-exchanges-{task_id}.jsonl"
    )


# --- Referrer-Policy ---------------------------------------------------------------


async def test_panel_and_shared_pages_send_no_referrer_to_other_origins(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="t-ref", user_id="user_test"))
        await _add_message(s, "t-ref", _msgs()[0])
        await _summarize(s, "t-ref")
        s.add(TaskShare(task_id="t-ref", visibility="public"))
        await s.commit()

    shared = client.get("/shared/t-ref")
    _override_web_user(client.app)
    try:
        pages = [client.get(p) for p in ("/app", "/app/tasks/t-ref", "/app/settings")]
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    for resp in [shared, *pages]:
        assert resp.status_code == 200
        # Not no-referrer: that would make the panel's own form posts send
        # "Origin: null", which the cross-site check refuses.
        assert resp.headers["referrer-policy"] == "same-origin", resp.url
