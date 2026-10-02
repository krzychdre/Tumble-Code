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


def test_the_composer_hides_the_rows_scrolling_under_it():
    """The live controls float a little above the window's bottom edge; the
    conversation showed through that gap, under the bar. A strip in the page
    colour fills it, from the bar down to the edge."""
    strip = _rule(".live-controls::after")
    assert "top: 100%;" in strip and "background: var(--bg);" in strip
    assert "height: calc(var(--s4) + 1px);" in strip
    bar = _CSS[_CSS.index(".live-controls {\n\tmargin-top"):]
    assert "bottom: var(--s4);" in bar[:bar.index("}")]


def test_a_long_run_scrolls_the_timeline_track_instead_of_cutting_it_off():
    """A run with more ticks than the track has room for (ticks shrink to 2px
    and no further) lost its end: the rail clipped the track. Both the strip
    and the rail scroll it now."""
    assert "overflow: auto;" in _rule(".tl-track")
    rail = _CSS[_CSS.index("@media (min-width: 1240px) {\n\t/* A rail"):]
    rail_track = rail[rail.index(".tl-track {"):]
    assert "overflow: hidden" not in rail_track[: rail_track.index("}")]


async def test_the_timeline_says_what_its_ticks_mean(client, session_factory):
    """A legend for the eye (each tick names itself to a screen reader)."""
    async with session_factory() as s:
        await _seed_user(s)
        s.add(Task(id="t", user_id="user_test"))
        await s.flush()
        await _add_message(s, "t", {"ts": 1, "type": "say", "say": "text", "text": "hi"})
        await s.commit()
    _override_web_user(client.app)
    try:
        html = client.get("/app/tasks/t").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
    nav = html[html.index('id="timeline"'):html.index("</nav>", html.index('id="timeline"'))]
    legend = re.search(r'<ul class="tl-legend" aria-hidden="true">(.*?)</ul>', nav, re.DOTALL)
    assert legend, nav
    for key in ("request", "error", "user"):
        assert f"tl-key-{key}" in legend.group(1), key
