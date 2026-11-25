"""Functional checks for the browser-side code (static/*.js).

The renderer and the task-list selection are the two pieces of this app with
real behaviour that the Python suite cannot reach: folding, per-role defaults,
fold state surviving a live upsert, shift-click ranges, the subtask option, and
which confirmation a given button asks all live in the browser.

Rather than add a Node/Playwright toolchain for them, the assertions live in
self-contained pages under ``tests/browser/`` that load the *actual* static
assets, exercise them, and write their results into the DOM. This test drives
each page with whatever headless Chrome is on the machine and fails if any
assertion did.

Skipped — never failed — when no Chrome is installed, so the suite still runs on
a bare CI box.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

_BROWSER_DIR = Path(__file__).parent / "browser"
_HARNESSES = sorted(_BROWSER_DIR.glob("*_checks.html"))

# Chrome and Chromium both work; the harnesses use nothing version-specific.
_CANDIDATES = ("google-chrome", "chromium", "chromium-browser", "google-chrome-stable")

# A harness that silently stopped asserting would otherwise "pass", so each
# declares the number of checks it is expected to run at minimum.
_MIN_CHECKS = {
    # The join acknowledgement against the header: registration-only record,
    # another task's snapshot, a snapshot without figures, this task's snapshot;
    # the run row of the spend table following this task's figures; the phone
    # fold; a live task sent to its tail once, an idle one not; the ask dock:
    # suggestions, own answer, approvals with a comment, no dock; the cockpit
    # header: its state word, its Stop, the Details summary and fold.
    "live_checks.html": 78,
    # Opens at the top unless live; follows new and growing rows at the bottom;
    # stops on scrolling up and counts what arrives; resumes on the pill or at
    # the bottom.
    "follow_checks.html": 19,
    "render_checks.html": 44,
    # Inline/display math, dollar amounts, code, tables, KaTeX trust off.
    "math_checks.html": 12,
    # Formula and wrapper openers without a closer, emphasis and raw-HTML bombs,
    # thousands of formulas: the page stays responsive and still formats
    # ordinary answers.
    "hostile_text_checks.html": 11,
    # Diagram image, labels, size, cache across a live update, invalid source kept.
    "mermaid_checks.html": 11,
    # Copy per row (Markdown as written, fences, no fold), the .md/.json download.
    "copy_download_checks.html": 17,
    # Local image paths rewritten to the serve URL, remote ones turned into
    # links, others left alone, live rows, the retry and the placeholder.
    "images_checks.html": 16,
    "resume_span_checks.html": 6,
    # Selection and the bulk delete; a row's delete dialog; the live strip
    # fetched again on the bridge's word, with the rows following it.
    "tasklist_checks.html": 40,
    # Groups and run trees served closed, the remembered ones reopened, opening
    # and closing kept.
    "taskfold_checks.html": 6,
    # Density toggle, select mode, and the 300 ms fetch-and-swap of the filter
    # form, with the remembered groups reopened in the swapped list.
    "tasklist_filter_checks.html": 20,
    # data-confirm forms (formerly inline onsubmit), a task's delete dialog, the
    # empty state's copy button, the auto-submitting filter form and the problem
    # report's "Copy for agent".
    "app_checks.html": 19,
    # The metrics region fetched again on an interval: opened table and cleared
    # series kept, unusable answers ignored, nothing asked while hidden.
    "refresh_checks.html": 10,
    # The theme applied in <head> and the auto/dark/light toggle, drawn as an icon.
    "theme_checks.html": 8,
    # Ticks per request/error/message, sizes by cost, jumps that wrap, live rows.
    "timeline_checks.html": 23,
    "tasktree_checks.html": 19,
    # escapeHtml must escape " and ' so values interpolated into double-quoted
    # src="..."/title="..." attributes cannot break out (CodeQL #8/#11).
    # 4 per sink: row rendered, attribute verbatim, no onerror, quote entity-encoded.
    "xss_attribute_checks.html": 8,
}


def _find_browser() -> str | None:
    for name in _CANDIDATES:
        path = shutil.which(name)
        if path:
            return path
    return None


@pytest.mark.parametrize("harness", _HARNESSES, ids=lambda p: p.name)
def test_browser_behaviour(harness: Path):
    browser = _find_browser()
    if browser is None:
        pytest.skip("no headless Chrome/Chromium available")

    result = subprocess.run(
        [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            # The harnesses assert asynchronously on window load; give the
            # virtual clock enough budget to get there before the DOM is dumped.
            "--virtual-time-budget=8000",
            "--dump-dom",
            harness.resolve().as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )

    dom = result.stdout
    match = re.search(r'<pre id="results">(.*?)</pre>', dom, re.DOTALL)
    assert match, (
        f"{harness.name} never wrote its results — it probably threw before "
        f"finishing. stderr:\n{result.stderr[-2000:]}"
    )

    report = match.group(1)
    failures = re.search(r"TOTAL_FAILURES=(\d+)", report)
    assert failures, f"no failure count in {harness.name} output:\n{report}"
    assert failures.group(1) == "0", f"{harness.name} checks failed:\n{report}"

    expected = _MIN_CHECKS.get(harness.name, 1)
    assert report.count("PASS") >= expected, (
        f"{harness.name} ran fewer checks than expected "
        f"({report.count('PASS')} < {expected}):\n{report}"
    )
