"""Every page of the web panel must fit a phone's screen.

A page wider than the screen is not scrolled sideways on a phone: the browser
zooms the whole page out until it fits. One element that refused to wrap was
enough to shrink everything else. On a 390px phone the list laid out 738px wide
(one long task title), and every other page 486px (the top bar), so all of
them read at 53-80% of their size.

The pages here are rendered by the app itself, with their assets pointed at
the static directory on disk, and laid out by headless Chrome in a frame 390px
wide (a phone; Chrome will not make a headless window narrower than 500px, and
at 500px the old top bar still fitted). A script in the page lists whatever
reaches past the right edge and posts it to the frame's parent, whose DOM is
what Chrome dumps.

Skipped, like the other browser checks, when no Chrome is installed.
"""

import json
import re
import subprocess
from pathlib import Path

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.task import Task
from tests.test_browser_js import _find_browser
from tests.test_web_and_share import (
    _add_message,
    _llm_event,
    _override_web_user,
    _seed_user,
    _summarize,
)

PHONE_WIDTH = 390
_STATIC = Path(__file__).resolve().parent.parent / "src" / "web" / "static"

# Runs inside the page once it has rendered (the conversation and the charts
# are drawn by script). An element counts as too wide only if nothing clips it:
# a long line inside a code block scrolls in its own box, which is fine. The
# edge is the content area: a desktop frame spends 15px of its 390 on a
# scrollbar, so a scrolling page is held to 375px, the narrowest phones.
_MEASURE = """
<script>
window.addEventListener("load", function () {
  setTimeout(function () {
    var vw = document.documentElement.clientWidth
    var wide = []
    document.querySelectorAll("body *").forEach(function (el) {
      var r = el.getBoundingClientRect()
      if (!r.width || r.right <= vw + 1) return
      for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible" && p.getBoundingClientRect().right <= vw + 1) return
      }
      var cls = typeof el.className === "string" ? el.className.trim() : ""
      if (cls) cls = "." + cls.split(/\\s+/).join(".")
      wide.push(el.tagName.toLowerCase() + cls + " reaches " + Math.round(r.right))
    })
    parent.postMessage(JSON.stringify({
      viewport: innerWidth,
      contentWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      wide: wide.slice(0, 15),
      rendered: {
        taskRows: document.querySelectorAll(".task-item").length,
        messages: document.querySelectorAll("#conversation .msg").length,
        spendTable: document.querySelectorAll(".spend-table").length,
        controls: document.querySelectorAll("#live-controls").length,
      },
    }), "*")
  }, 300)
})
</script>
"""

_FRAME = f"""<!DOCTYPE html><html><body style="margin:0">
<iframe src="page.html" style="border:0;width:{PHONE_WIDTH}px;height:844px"></iframe>
<script>
window.addEventListener("message", function (e) {{
  var pre = document.createElement("pre")
  pre.id = "results"
  pre.textContent = e.data
  document.body.appendChild(pre)
}})
</script>
</body></html>"""


def _lay_out_on_a_phone(html: str, tmp_path: Path) -> dict:
    """Lay ``html`` out 390px wide and report what reaches past the edge."""
    browser = _find_browser()
    if browser is None:
        pytest.skip("no headless Chrome/Chromium available")
    page = html.replace('"/static/', f'"{_STATIC.as_uri()}/').replace("</body>", _MEASURE + "</body>")
    (tmp_path / "page.html").write_text(page, encoding="utf-8")
    (tmp_path / "frame.html").write_text(_FRAME, encoding="utf-8")
    result = subprocess.run(
        [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--virtual-time-budget=8000",
            "--dump-dom",
            (tmp_path / "frame.html").as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    match = re.search(r'<pre id="results">(.*?)</pre>', result.stdout, re.DOTALL)
    assert match, f"the page never reported its layout. stderr:\n{result.stderr[-2000:]}"
    return json.loads(match.group(1).replace("&quot;", '"').replace("&amp;", "&"))


_LONG_TITLE = (
    "Implement changes described in @/private_docs/prime-ingress-nosuchkey/analysis.md. DRY, YAGNI, "
    "OCP. AWS PROD credentials are in the system, use them READ-ONLY and report back what you found"
)


async def _seed_a_phone_sized_problem(session_factory):
    """A run with every element that ever overflowed on a phone: a long title,
    a long worktree path, a model badge, a subtask, request rows with figures,
    a long command and a code block with a line no screen could hold."""
    async with session_factory() as s:
        await _seed_user(s)
        s.add(
            Task(
                id="run",
                user_id="user_test",
                title=_LONG_TITLE,
                workspace_path="/home/someone/Projekty/ITKONTEKST/customer/lids-uniform-api-with-a-long-name",
            )
        )
        await s.flush()
        s.add(
            Task(id="sub", user_id="user_test", title="Write the analysis document " * 4, parent_task_id="run")
        )
        await s.flush()
        messages = [
            {"ts": 1, "type": "say", "say": "text", "text": _LONG_TITLE},
            {
                "ts": 2,
                "type": "say",
                "say": "api_req_started",
                "text": json.dumps({"tokensIn": 16462, "tokensOut": 358, "cost": 0.0245}),
            },
            {
                "ts": 3,
                "type": "ask",
                "ask": "command",
                "text": "uv run pytest -q tests/test_web_and_share.py -k 'states_the_run_total or fits_a_phone'",
            },
            {
                "ts": 4,
                "type": "say",
                "say": "completion_result",
                "text": "Done.\n\n```\n" + "x" * 400 + "\n```",
            },
        ]
        for message in messages:
            await _add_message(s, "run", message)
        figures = json.dumps({"tokensIn": 3000, "tokensOut": 50, "cost": 1.2})
        await _add_message(s, "sub", {"ts": 5, "type": "say", "say": "api_req_started", "text": figures})
        s.add(_llm_event(task_id="run", model="GLM-5.3-NVFP4-with-a-long-local-suffix", tin=16462, tout=358))
        await _summarize(s, "run", "sub")
        await s.commit()


@pytest.mark.parametrize(
    "path, rendered",
    [
        ("/app", "taskRows"),
        ("/app?scope=all", "taskRows"),
        ("/app/tasks/run", "messages"),
        ("/app/metrics", None),
        ("/app/settings", None),
    ],
)
async def test_every_page_fits_a_phone(path, rendered, client, session_factory, monkeypatch, tmp_path):
    from config.settings import settings as app_settings

    # The owner's live controls are part of the task page a phone shows.
    monkeypatch.setattr(app_settings, "bridge_enabled", True)
    await _seed_a_phone_sized_problem(session_factory)

    _override_web_user(client.app)
    try:
        html = client.get(path).text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    layout = _lay_out_on_a_phone(html, tmp_path)

    # Not vacuous: the frame is a phone, and the page drew what it is about.
    assert layout["viewport"] == PHONE_WIDTH
    if rendered:
        assert layout["rendered"][rendered] > 0, layout
    if path == "/app/tasks/run":
        assert layout["rendered"]["spendTable"] == 1 and layout["rendered"]["controls"] == 1, layout

    assert layout["wide"] == [], f"{path} reaches past a {layout['contentWidth']}px screen: {layout['wide']}"
    assert layout["scrollWidth"] <= layout["contentWidth"], layout
