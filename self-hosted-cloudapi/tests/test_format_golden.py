"""One table of numbers and the strings they must print as, in Python and in JS.

The server renders token counts and costs (``src/utils/format.py``) and the
page's scripts rewrite some of them live (``static/format.js``: the task
header while a task runs, the API rows, the metrics charts). Each table row
below is checked against both, so a figure never changes its spelling when the
browser takes it over.

Two decisions are pinned here on purpose:

* Below a thousand a token count is rounded to the nearest integer, a tie going
  up (JavaScript's ``Math.round``). Token counts are integers in practice; the
  copies this replaced truncated (Python), printed the raw number (live.js) or
  rounded (metrics.js).
* A true decimal tie rounds away from zero, as ``Number.toFixed`` does:
  1250 tokens is "1.3k" and $0.03125 is "$0.0313". Python's ``"%.4f"`` sent a
  tie to the even digit ("1.2k", "$0.0312"), so the server and the live header
  could print the same figure two ways.

The JS half runs in headless Chrome and is skipped, like the other browser
checks, when no Chrome is installed.
"""

import json
import re
import subprocess
from pathlib import Path

import pytest

from src.utils.format import fmt_bytes, fmt_cost, fmt_int, fmt_tokens, plural, round_half_up

from tests.test_browser_js import _find_browser

_FORMAT_JS = Path(__file__).resolve().parent.parent / "src" / "web" / "static" / "format.js"

TOKENS = [
    (0, "0"),
    (1, "1"),
    (512, "512"),
    (999, "999"),
    # Rounded to the nearest integer below a thousand, a tie going up.
    (0.4, "0"),
    (0.5, "1"),
    (2.5, "3"),
    (512.7, "513"),
    (999.4, "999"),
    (999.6, "1000"),
    (-0.4, "0"),
    (-2.5, "-2"),
    # One decimal from a thousand up, a trailing ".0" dropped.
    (1000, "1k"),
    (1049, "1k"),
    (1050, "1.1k"),
    (1250, "1.3k"),
    (1350, "1.4k"),
    (-1250, "-1.3k"),
    (-1500, "-1.5k"),
    (5_900, "5.9k"),
    (96_941, "96.9k"),
    (297_800, "297.8k"),
    (303_700, "303.7k"),
    (999_960, "1000k"),
    (1_000_000, "1M"),
    (1_193_234, "1.2M"),
    (3_000_000, "3M"),
    (1_500_000_000, "1.5B"),
    (2_000_000_000_000, "2000B"),
]

COSTS = [
    (0, "$0.0000"),
    (0.1656, "$0.1656"),
    (1.5, "$1.5000"),
    (0.00005, "$0.0001"),
    (0.00004, "$0.0000"),
    (0.03125, "$0.0313"),
    (0.1234 + 0.03125, "$0.1547"),
    (0.1656 + 1.194 + 0.0493, "$1.4089"),
    (12.3456789, "$12.3457"),
    (1234.5, "$1234.5000"),
]


@pytest.mark.parametrize(("value", "expected"), TOKENS)
def test_python_formats_tokens(value, expected):
    assert fmt_tokens(value) == expected


@pytest.mark.parametrize(("value", "expected"), COSTS)
def test_python_formats_costs(value, expected):
    assert fmt_cost(value) == expected


def test_round_half_up_is_math_round():
    assert [round_half_up(x) for x in (0.49999999999999994, 0.5, 1.5, 2.5, -0.5, -1.5, -2.5)] == [
        0, 1, 2, 3, 0, -1, -2
    ]


def test_whole_counts_get_thousands_separators():
    assert fmt_int(0) == "0"
    assert fmt_int(999) == "999"
    assert fmt_int(1_234_567) == "1,234,567"
    assert fmt_int(-1234) == "-1,234"
    assert fmt_int(1234.5) == "1,235"


def test_plural_and_byte_size():
    assert plural(1, "task") == "1 task"
    assert plural(3, "task") == "3 tasks"
    assert fmt_bytes(1536) == "1.5 KB"
    assert fmt_bytes(512) == "512 B"


_HARNESS = """<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<pre id="results"></pre>
<script src="{format_js}"></script>
<script>
var vectors = {vectors}
var lines = [], failures = 0
function check(kind, fn, rows) {{
  rows.forEach(function (row) {{
    var got = fn(row[0])
    if (got === row[1]) lines.push("PASS " + kind + " " + row[0])
    else {{ failures++; lines.push("FAIL " + kind + " " + row[0] + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(row[1])) }}
  }})
}}
try {{
  check("tokens", window.TumbleFormat.tokens, vectors.tokens)
  check("cost", window.TumbleFormat.cost, vectors.cost)
}} catch (e) {{ failures++; lines.push("FAIL threw " + e) }}
lines.push("TOTAL_FAILURES=" + failures)
document.getElementById("results").textContent = lines.join("\\n")
</script></body></html>
"""


def test_format_js_prints_the_same_strings(tmp_path: Path):
    browser = _find_browser()
    if browser is None:
        pytest.skip("no headless Chrome/Chromium available")

    harness = tmp_path / "format_golden.html"
    harness.write_text(
        _HARNESS.format(
            format_js=_FORMAT_JS.as_uri(),
            vectors=json.dumps({"tokens": TOKENS, "cost": COSTS}),
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [browser, "--headless", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
         "--dump-dom", harness.as_uri()],
        capture_output=True,
        text=True,
        timeout=120,
    )

    match = re.search(r'<pre id="results">(.*?)</pre>', result.stdout, re.DOTALL)
    assert match and "TOTAL_FAILURES=" in match.group(1), (
        f"the harness never reported. stderr:\n{result.stderr[-2000:]}"
    )
    report = match.group(1)
    assert "TOTAL_FAILURES=0" in report, report
    assert report.count("PASS") == len(TOKENS) + len(COSTS), report
