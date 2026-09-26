"""Golden token/cost fixtures shared with the extension (CAPI-M8).

A task's token and cost totals are computed three times: by the extension's
``consolidateTokenUsage`` (packages/core, the authoritative one), by
``task_summary.message_metrics`` here (one message at a time, summed by the
task rollup) and by ``render.js`` ``getMetrics`` in the web view. The cases and
their expected totals live in ONE file, ``tests/fixtures/token_usage_golden.json``;
the vitest spec ``consolidateTokenUsage.golden.spec.ts`` checks the TypeScript
side against it, this module checks the Python function and the browser code.

``expected`` is what TypeScript returns. A case whose ``knownDivergences``
names ``python`` (or ``js``) is a recorded disagreement: the check expects the
mismatch (strict xfail), so fixing the divergence makes it fail until the entry
is removed from the fixture.
"""

import json
import re
import subprocess
from pathlib import Path

import pytest

from src.services.task_summary import message_metrics
from tests.test_browser_js import _find_browser

_TESTS = Path(__file__).parent
_FIXTURE = _TESTS / "fixtures" / "token_usage_golden.json"
_STATIC = _TESTS.parent / "src" / "web" / "static"
_HARNESS = _TESTS / "browser" / "token_golden.js"

_CASES = json.loads(_FIXTURE.read_text(encoding="utf-8"))["cases"]


def _python_params() -> list:
    params = []
    for case in _CASES:
        reason = case.get("knownDivergences", {}).get("python")
        marks = [pytest.mark.xfail(strict=True, reason=reason)] if reason else []
        params.append(pytest.param(case, id=case["name"], marks=marks))
    return params


def test_fixture_is_well_formed():
    names = [c["name"] for c in _CASES]
    assert len(names) >= 15
    assert len(names) == len(set(names)), "case names must be unique"
    for case in _CASES:
        assert set(case["expected"]) == {
            "totalTokensIn",
            "totalTokensOut",
            "totalCacheWrites",
            "totalCacheReads",
            "totalCost",
            "contextTokens",
        }, case["name"]
        assert set(case.get("knownDivergences", {})) <= {"python", "js"}, case["name"]


@pytest.mark.parametrize("case", _python_params())
def test_message_metrics_matches_golden_totals(case):
    # The rollup is SUM over the per-message columns (refresh_task_summary), so
    # summing message_metrics is exactly what the task row ends up holding.
    totals = [message_metrics(m) for m in case["messages"]]
    expected = case["expected"]

    # message_metrics has no "unreported": its columns are NOT NULL, so a cache
    # total TypeScript leaves undefined is 0 here.
    assert sum(t.tokens_in for t in totals) == expected["totalTokensIn"]
    assert sum(t.tokens_out for t in totals) == expected["totalTokensOut"]
    assert sum(t.cache_writes for t in totals) == (expected["totalCacheWrites"] or 0)
    assert sum(t.cache_reads for t in totals) == (expected["totalCacheReads"] or 0)
    assert sum(t.cost for t in totals) == pytest.approx(expected["totalCost"], abs=1e-9)


def test_render_js_get_metrics_matches_golden_totals(tmp_path):
    browser = _find_browser()
    if browser is None:
        pytest.skip("no headless Chrome/Chromium available")

    # The fixture is inlined as a JSON island (a file:// page may not fetch a
    # sibling file); "</" is escaped so no string in it can close the script.
    island = _FIXTURE.read_text(encoding="utf-8").replace("</", "<\\/")
    page = tmp_path / "token_golden.html"
    page.write_text(
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>\n'
        f'<script id="golden" type="application/json">{island}</script>\n'
        f'<script src="{(_STATIC / "vendor" / "marked.min.js").as_uri()}"></script>\n'
        f'<script src="{(_STATIC / "vendor" / "purify.min.js").as_uri()}"></script>\n'
        # render.js formats costs through static/format.js, as the page loads it.
        f'<script src="{(_STATIC / "format.js").as_uri()}"></script>\n'
        f'<script src="{(_STATIC / "render.js").as_uri()}"></script>\n'
        f'<script src="{_HARNESS.as_uri()}"></script>\n'
        "</body></html>\n",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--virtual-time-budget=8000",
            "--dump-dom",
            page.as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )

    match = re.search(r'<pre id="results">(.*?)</pre>', result.stdout, re.DOTALL)
    assert match, f"the harness never wrote its results. stderr:\n{result.stderr[-2000:]}"
    report = match.group(1)
    assert "TOTAL_FAILURES=0" in report, f"render.js getMetrics disagrees:\n{report}"
    # Every case must have been checked, not just the ones before a crash.
    assert report.count("PASS") == len(_CASES), report
