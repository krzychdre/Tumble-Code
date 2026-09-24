"""JSON islands must not let stored data break out of their ``<script>`` element.

The conversation views hand the browser their data as JSON inside
``<script type="application/json">`` elements ("islands"). The HTML parser ends
such an element at the first ``</script`` it meets, whatever JSON says about
string quoting, so a message whose text contains ``</script><img onerror=...>``
used to close the island early and run as markup (DEF-S2). That text reaches
the page through a public share link, so it is a stored XSS reachable by anyone
holding the link.

The checks below read each island the way a browser does (up to the first
``</script``), then require that the JSON parses back to exactly the data that
was stored and that no raw ``</script><img`` reaches the HTML.
"""

import json
import re
from pathlib import Path

from sqlalchemy import select

from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskShare

from tests.test_model_attribution import _req
from tests.test_web_and_share import (
    _add_message,
    _llm_event,
    _override_web_user,
    _seed_user,
    _summarize,
)

BREAKOUT = "</script><img src=x onerror=alert(1)>"
COMMENT = "<!--<script>"
LINE_SEPARATORS = "\u2028 and \u2029"
TEMPLATES = Path(__file__).resolve().parent.parent / "src" / "web" / "templates"


def _hostile_messages() -> list[dict]:
    return [
        {"ts": 1, "type": "say", "say": "text", "text": f"Build {BREAKOUT} please"},
        {"ts": 2, "type": "say", "say": "text", "text": f"{COMMENT} still text"},
        {"ts": 3, "type": "say", "say": "text", "text": f"A & B > C, {LINE_SEPARATORS}"},
    ]


def _island(html: str, element_id: str):
    """Parse one island exactly as the browser's tokenizer delimits it."""
    opening = re.search(
        rf'<script id="{element_id}" type="application/json">', html
    )
    assert opening is not None, f"island #{element_id} is missing"
    rest = html[opening.end():]
    end = re.search(r"</script", rest, re.IGNORECASE)
    assert end is not None, f"island #{element_id} is never closed"
    return json.loads(rest[: end.start()])


async def _seed_hostile_task(session_factory, task_id: str, *, share: bool) -> None:
    async with session_factory() as s:
        s.add(Task(id=task_id, user_id="user_test"))
        await s.flush()
        for message in _hostile_messages():
            await _add_message(s, task_id, message)
        # One request answered by a model whose name is attacker-chosen text:
        # the name travels to the page through the request-models island.
        await _add_message(s, task_id, _req(10, 111, 22))
        s.add(_llm_event(task_id=task_id, model=BREAKOUT, tin=111, tout=22))
        if share:
            s.add(
                TaskShare(
                    task_id=task_id,
                    visibility="public",
                    share_url=f"http://testserver/shared/{task_id}",
                )
            )
        await _summarize(s, task_id)
        await s.commit()


def _assert_islands_hold(html: str) -> None:
    assert "</script><img" not in html
    messages = _island(html, "messages-data")
    assert messages[:3] == _hostile_messages()
    assert _island(html, "request-models") == {"10": {"model": BREAKOUT, "mode": "code"}}


async def test_shared_page_islands_survive_hostile_message_text(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_hostile_task(session_factory, "task-xss-share", share=True)

    resp = client.get("/shared/task-xss-share")

    assert resp.status_code == 200
    _assert_islands_hold(resp.text)


async def test_owner_task_page_islands_survive_hostile_message_text(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_hostile_task(session_factory, "task-xss-owner", share=False)

    _override_web_user(client.app)
    try:
        resp = client.get("/app/tasks/task-xss-owner")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    _assert_islands_hold(resp.text)
    live = _island(resp.text, "live-config")
    assert live["taskId"] == "task-xss-owner"


async def test_metrics_island_survives_a_hostile_model_name(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(_llm_event(model=BREAKOUT, mode=COMMENT))
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.get("/app/metrics?period=all")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "</script><img" not in resp.text
    chart = _island(resp.text, "metrics-data")
    assert chart["model_labels"] == [BREAKOUT]
    assert chart["mode_labels"] == [COMMENT]


def test_json_for_script_escapes_everything_that_can_end_or_confuse_an_island():
    from src.utils.json_script import json_for_script

    data = {"text": f"{BREAKOUT} {COMMENT} & {LINE_SEPARATORS} ]]>"}

    rendered = str(json_for_script(data))

    for raw in ("<", ">", "&", "\u2028", "\u2029"):
        assert raw not in rendered
    assert json.loads(rendered) == data


def test_no_template_marks_an_island_safe_by_hand():
    """Every island goes through json_for_script, never ``| safe``.

    ``| safe`` on a string built with ``json.dumps`` is exactly the pattern
    that let the breakout through; the helper returns markup that is already
    safe, so a template never needs the filter on an island.
    """
    offenders = []
    for template in sorted(TEMPLATES.glob("*.html")):
        for number, line in enumerate(template.read_text().splitlines(), start=1):
            if 'type="application/json"' in line and "safe" in line:
                offenders.append(f"{template.name}:{number}")
    assert offenders == []


# --- completions belong to the task's owner ---------------------------------


async def test_another_users_telemetry_cannot_name_the_model_of_my_task(
    client, db_session, session_factory
):
    """Task ids are chosen by the client, so any account can send telemetry
    that names my task. Only the owner's events may attribute its requests."""
    from src.services.model_attribution import completions_for_task

    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-own", user_id="user_test"))
        await s.flush()
        await _add_message(s, "task-own", _req(1, 50, 5))
        s.add(_llm_event(task_id="task-own", model="mine", tin=50, tout=5))
        s.add(
            _llm_event(
                user_id="user_other", task_id="task-own", model=BREAKOUT, tin=50, tout=5
            )
        )
        await _summarize(s, "task-own")
        await s.commit()

    found = await completions_for_task(db_session, "task-own", "user_test")
    assert [c.model for c in found] == ["mine"]

    stored = await db_session.scalar(select(Task.models).where(Task.id == "task-own"))
    assert stored == "mine"

    _override_web_user(client.app)
    try:
        resp = client.get("/app/tasks/task-own")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
    assert resp.status_code == 200
    assert BREAKOUT not in resp.text
    assert _island(resp.text, "request-models") == {"1": {"model": "mine", "mode": "code"}}


async def test_completions_for_task_without_an_owner_finds_nothing(db_session):
    from src.services.model_attribution import completions_for_task

    await _seed_user(db_session)
    db_session.add(_llm_event(task_id="task-orphan", model="someone"))
    await db_session.commit()

    assert await completions_for_task(db_session, "task-orphan", None) == []

