"""The task page's timeline, jumps, skeleton and row containment (UI plan 3.3).

The timeline itself is drawn by static/timeline.js from the rendered
conversation (tests/browser/timeline_checks.html); these check what the
server sends for it: the empty, hidden frame with the two jump buttons, the
script after the renderer, the skeleton in place of "Rendering
conversation...", and the CSS that lets a long conversation skip laying out
the rows off screen.
"""

import re
from pathlib import Path

from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskShare
from tests.web_helpers import _add_message, _msgs, _override_web_user, _seed_user, _summarize

_CSS = (Path(__file__).resolve().parent.parent / "src" / "web" / "static" / "app.css").read_text(encoding="utf-8")


async def _pages(client, session_factory):
    async with session_factory() as s:
        await _seed_user(s)
        s.add(Task(id="run", user_id="user_test"))
        await s.flush()
        for m in _msgs():
            await _add_message(s, "run", m)
        s.add(TaskShare(task_id="run", visibility="public", share_url="http://testserver/shared/run"))
        await _summarize(s, "run")
        await s.commit()
    _override_web_user(client.app)
    try:
        owner = client.get("/app/tasks/run").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
    return {"owner": owner, "shared": client.get("/shared/run").text}


async def test_the_timeline_frame_and_jumps_are_on_both_task_pages(client, session_factory):
    for name, html in (await _pages(client, session_factory)).items():
        nav = re.search(r'<nav id="timeline"[^>]*>', html)
        assert nav and "hidden" in nav.group(0) and 'aria-label="Conversation timeline"' in nav.group(0), name
        assert html.index('id="timeline"') < html.index('id="conversation"'), name
        for button in ("tl-next-error", "tl-next-user"):
            assert re.search(rf'<button type="button" id="{button}"', html), (name, button)
        assert 'id="tl-track"' in html, name
        scripts = re.findall(r'<script src="/static/([\w.]+)\?v=', html)
        assert scripts.index("timeline.js") == scripts.index("render.js") + 1, (name, scripts)


async def test_a_skeleton_stands_in_while_the_conversation_renders(client, session_factory):
    html = (await _pages(client, session_factory))["owner"]
    convo = html[html.index('<div id="conversation"'):]
    convo = convo[:convo.index('<div id="live-controls"')] if 'id="live-controls"' in convo else convo
    loading = re.search(r'<div class="loading skeleton"[^>]*>(.*?)</div>\s*</div>', convo, re.DOTALL)
    assert loading, "no skeleton"
    assert 'role="status"' in loading.group(0)
    # The words are for a screen reader; the eye sees placeholder rows.
    assert '<span class="sr-only">Rendering conversation…</span>' in loading.group(0)
    assert convo.count('class="skeleton-row') >= 3


def _rule(selector: str) -> str:
    start = _CSS.index(selector + " {")
    return _CSS[start:_CSS.index("}", start)]


def test_offscreen_rows_skip_layout_and_the_skeleton_can_be_still():
    row = _rule(".msg")
    assert "content-visibility: auto;" in row
    assert re.search(r"contain-intrinsic-size: auto 120px;", row)
    # The shimmer is motion: the reduced-motion rule already stops animations
    # globally, and the skeleton keeps its shape without it.
    assert "@keyframes skeleton" in _CSS
