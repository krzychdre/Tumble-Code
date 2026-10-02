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

The second half holds every page to a stricter rule with hostile data (an
unbroken prompt as the title, a 60-character model id, a path with no breaks,
a long account name): no text may run past the box it sits in, at a phone's
width and at 900px, where the top bar still shows the account name. Text may
be cut with an ellipsis or scroll inside its own box (a code block); it may
not be clipped without a sign, or spill over its neighbours.

Skipped, like the other browser checks, when no Chrome is installed.
"""

import json
import re
import subprocess
from pathlib import Path

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskShare
from tests.test_browser_js import _find_browser
from tests.web_helpers import (
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
    // Text running past its own box: each text node's right edge against the
    // boxes around it, up to the first one that clips. A scroll box or an
    // ellipsis tells the reader there is more; a bare hidden/clip does not, so
    // text past a box like that counts too. The sorted column's arrow hangs
    // past its label on purpose (app.css, .head-sort.sorted).
    var spill = []
    function label(el) {
      var c = typeof el.className === "string" ? el.className.trim() : ""
      return el.tagName.toLowerCase() + (c ? "." + c.split(/\\s+/).join(".") : "")
    }
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      var host = n.parentElement
      if (!n.textContent.trim() || !host || host.closest("script,style,noscript,.sr-only,svg,select,option,datalist,.head-sort")) continue
      var range = document.createRange()
      range.selectNodeContents(n)
      var right = 0
      Array.prototype.forEach.call(range.getClientRects(), function (q) { right = Math.max(right, q.right) })
      if (!right) continue
      for (var box = host; box && box !== document.documentElement; box = box.parentElement) {
        var cs = getComputedStyle(box)
        var edge = box.getBoundingClientRect().right
        if (cs.overflowX !== "visible") {
          var signed = cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.textOverflow === "ellipsis"
          if (!signed && right > edge + 1) spill.push("cut by " + label(box) + ": " + n.textContent.trim().slice(0, 40))
          break
        }
        if (cs.display !== "inline" && cs.display !== "contents" && right > edge + 1) {
          spill.push("past " + label(box) + ": " + n.textContent.trim().slice(0, 40))
          break
        }
      }
    }
    parent.postMessage(JSON.stringify({
      viewport: innerWidth,
      contentWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      wide: wide.slice(0, 15),
      spill: spill.slice(0, 15),
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

_FRAME = """<!DOCTYPE html><html><body style="margin:0">
<iframe src="page.html" style="border:0;width:WIDTHpx;height:844px"></iframe>
<script>
window.addEventListener("message", function (e) {
  var pre = document.createElement("pre")
  pre.id = "results"
  pre.textContent = e.data
  document.body.appendChild(pre)
})
</script>
</body></html>"""


def _lay_out_on_a_phone(html: str, tmp_path: Path, width: int = PHONE_WIDTH) -> dict:
    """Lay ``html`` out ``width`` px wide (a phone by default) and report what
    reaches past the edge and what text runs past its box."""
    browser = _find_browser()
    if browser is None:
        pytest.skip("no headless Chrome/Chromium available")
    page = html.replace('"/static/', f'"{_STATIC.as_uri()}/').replace("</body>", _MEASURE + "</body>")
    (tmp_path / "page.html").write_text(page, encoding="utf-8")
    (tmp_path / "frame.html").write_text(_FRAME.replace("WIDTH", str(width)), encoding="utf-8")
    result = subprocess.run(
        [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            # Wide enough for a 900px frame; a 390px one sits at its left.
            "--window-size=1000,900",
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
        # The filter panel opens when a filter beyond the search is active.
        ("/app?project=lids&sort=cost&dir=desc", "taskRows"),
        ("/app/tasks/run", "messages"),
        ("/app/metrics", None),
        ("/app/diagnostics", None),
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


# --- Long text stays inside its box ------------------------------------------

_NOSPACE = (
    "Implement_the_changes_described_in_private_docs_prime-ingress-nosuchkey_analysis_md"
    "_DRY_YAGNI_OCP_and_report_back_everything_you_found"
)
_LONG_MODEL = "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct"
_LONG_PATH = (
    "/home/someone/Projekty/ITKONTEKST/customer/data-products-molecular/services/ingestion"
    "/very_long_directory_name_without_any_breaks/src/main/kotlin/IngestionController.kt"
)
_LONG_URL = "https://example.com/QUB-IT/Roo-Code/blob/main/app.css?very_long_query_param=" + "abcdefghij" * 6


async def _seed_hostile_text(session_factory):
    """A run whose every label is as long as real ones get, and longer: an
    unbroken prompt, a long model id and mode, a path without a break, a
    command line, a wide Markdown table, a tool with a long name, a nested
    subtask chain, and figures in the thousands of dollars."""
    async with session_factory() as s:
        await _seed_user(s)
        s.add(Task(id="run", user_id="user_test", workspace_path=_LONG_PATH))
        await s.flush()
        s.add(Task(id="sub1", user_id="user_test", parent_task_id="run", workspace_path=_LONG_PATH))
        await s.flush()
        s.add(Task(id="sub2", user_id="user_test", parent_task_id="sub1", workspace_path=_LONG_PATH))
        await s.flush()
        table = "| " + " | ".join(f"column_{i}_with_a_long_header" for i in range(6)) + " |\n"
        table += "|" + "---|" * 6 + "\n| " + " | ".join(_LONG_MODEL for _ in range(6)) + " |"
        conversation = [
            {"ts": 1, "type": "say", "say": "text", "text": _NOSPACE + " " + _LONG_URL},
            {"ts": 2, "type": "say", "say": "api_req_started",
             "text": json.dumps({"tokensIn": 1234567890, "tokensOut": 987654321, "cost": 12345.6789})},
            {"ts": 3, "type": "ask", "ask": "command", "text": "cd " + _LONG_PATH + " && uv run pytest -q -k 'a or b' 2>&1 | tail -n 200"},
            {"ts": 4, "type": "ask", "ask": "tool",
             "text": json.dumps({"tool": "readFileWithAVeryLongToolNameThatNeverEnds", "path": _LONG_PATH, "content": _LONG_PATH})},
            {"ts": 5, "type": "say", "say": "some_unknown_kind_with_a_very_long_name_that_has_no_label", "text": "{}"},
            {"ts": 6, "type": "say", "say": "error", "text": "Error: 400 " + _NOSPACE + " " + _LONG_URL},
            {"ts": 7, "type": "say", "say": "text", "text": "A table:\n\n" + table + "\n\nInline `" + _NOSPACE + "`"},
        ]
        for message in conversation:
            await _add_message(s, "run", message)
        for i, task_id in enumerate(("sub1", "sub2")):
            await _add_message(s, task_id, {"ts": 10 + i, "type": "say", "say": "text", "text": f"Subtask{i}_" + _NOSPACE})
            figures = json.dumps({"tokensIn": 99999999, "tokensOut": 8888888, "cost": 2999.97})
            await _add_message(s, task_id, {"ts": 20 + i, "type": "say", "say": "api_req_started", "text": figures})
        for model in (_LONG_MODEL, "openrouter/anthropic/claude-opus-5.5-20261001-thinking-extended-context-1m"):
            for task_id in ("run", "sub1"):
                s.add(_llm_event(task_id=task_id, model=model, mode="architect-reviewer-with-a-long-custom-slug",
                                 provider="openai-compatible-self-hosted-gateway", tin=123456789, tout=1234567, cost=1234.56))
        s.add(TaskShare(task_id="run", visibility="public", share_url="http://testserver/shared/run"))
        await _summarize(s, "run", "sub1", "sub2")
        await s.commit()


@pytest.mark.parametrize("width", [PHONE_WIDTH, 900])
@pytest.mark.parametrize(
    "path",
    [
        "/app?scope=all",
        # Nothing matches: the empty state lists the filters as chips.
        f"/app?q={_NOSPACE}&project={_NOSPACE}&model={_LONG_MODEL}",
        "/app/tasks/run",
        "/app/tasks/sub2",
        "/app/metrics?period=all",
        "/shared/run",
    ],
)
async def test_long_text_stays_inside_its_box(path, width, client, session_factory, monkeypatch, tmp_path):
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)
    await _seed_hostile_text(session_factory)
    client.app.dependency_overrides[get_web_user_optional] = lambda: {
        "user_id": "user_test",
        "session_id": "sess_test",
        "email": "t@example.com",
        # At 900px the bar still shows the name: a long one must not push
        # Sign out off the screen.
        "name": "Krzysztof Drezewski-Wielkopolski von Supercalifragilistic",
        "image_url": None,
    }
    try:
        response = client.get(path)
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
    assert response.status_code == 200, path

    layout = _lay_out_on_a_phone(response.text, tmp_path, width)

    assert layout["viewport"] == width
    assert layout["wide"] == [], f"{path} at {width}px reaches past the screen: {layout['wide']}"
    assert layout["scrollWidth"] <= layout["contentWidth"], layout
    assert layout["spill"] == [], f"{path} at {width}px: text outside its box: {layout['spill']}"


# --- The rules that keep it there -------------------------------------------
# Cheap, browser-free pins for the rules the layout checks above depend on, so
# a later edit that drops one fails here with a name, even where no Chrome is
# installed.

_CSS = (_STATIC / "app.css").read_text(encoding="utf-8")


def _rule(selector: str) -> str:
    """The body of the first rule whose selector list is exactly ``selector``."""
    match = re.search(r"(?:^|\})\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", _CSS, re.MULTILINE)
    assert match, f"app.css has no rule for {selector}"
    return match.group(1)


@pytest.mark.parametrize(
    "selector, declaration",
    [
        # A title with an unbroken path breaks inside the word.
        (".page-title", "overflow-wrap: anywhere"),
        # ...and in the detail header it shrinks beside the Delete button.
        (".detail-title-row .page-title", "flex: 1 1 auto"),
        (".task-delete-detail", "flex-shrink: 0"),
        # Empty and error states carry URLs and addresses.
        (".empty", "overflow-wrap: anywhere"),
        # A long account name yields in the top bar.
        (".topbar-end", "min-width: 0"),
        (".user-name", "text-overflow: ellipsis"),
        # Filter chips are text, not flex rows that squeeze the label.
        (".filter-chip", "display: inline-block"),
        # The model ids in the detail header wrap inside their badges.
        (".detail-models .badge-model", "overflow-wrap: anywhere"),
        # Conversation: a long role label, commands, Markdown tables.
        (".msg-role", "max-width: 100%"),
        (".msg.role-command .msg-body pre", "white-space: pre-wrap"),
        (".msg-body table", "overflow-x: auto"),
        # Stat figures scale with their tile.
        (".stat-card", "container-type: inline-size"),
    ],
)
def test_overflow_rule_is_in_the_stylesheet(selector, declaration):
    assert declaration in _rule(selector), f"{selector} lost `{declaration}`"
