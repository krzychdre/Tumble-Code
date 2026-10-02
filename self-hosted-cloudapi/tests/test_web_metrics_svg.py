"""The metrics charts as server-rendered inline SVG (UI plan 3.4).

They used to be three Chart.js canvases (a 290 KB script, drawn after load,
with a dual-axis tokens-and-cost chart). Now the page itself carries them,
like the grade and kind bars: no script, they follow the theme through CSS
classes (no colour in the markup), they print, and each is role="img" with
a summary, linked to the table that holds the same figures. Tokens and cost
per day are two smooth lines on one plot with an axis each, the legend's
checkboxes hide either series without a script, and the daily table is paged.
"""

import re
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path

from src.auth.web_session import get_web_user_optional
from tests.web_helpers import _llm_event, _override_web_user, _seed_user

_WEB = Path(__file__).resolve().parent.parent / "src" / "web"


async def _page(client, session_factory, events):
    async with session_factory() as s:
        await _seed_user(s)
        s.add_all(events)
        await s.commit()
    _override_web_user(client.app)
    try:
        return client.get("/app/metrics?period=all").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)


def _svgs(html: str) -> list[str]:
    return re.findall(r"<svg\b.*?</svg>", html, re.DOTALL)


def _days(n: int):
    base = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
    return [base + timedelta(days=i) for i in range(n)]


async def test_the_charts_are_inline_svg_and_chart_js_is_gone(client, session_factory):
    html = await _page(
        client,
        session_factory,
        [_llm_event(created_at=d, tin=1000 * (i + 1), cost=0.01 * (i + 1)) for i, d in enumerate(_days(3))],
    )
    assert "chart.umd.min.js" not in html
    assert "/static/metrics.js" not in html
    assert 'id="metrics-data"' not in html
    assert "<canvas" not in html
    charts = [s for s in _svgs(html) if 'class="chart-svg' in s]
    # Tokens and cost per day on one plot, then models and modes.
    assert len(charts) == 3
    for svg in charts:
        opening = svg[:svg.index(">")]
        assert 'role="img"' in opening and 'aria-label="' in opening
        # Colour comes from the stylesheet (theme, print), never the markup.
        assert not re.search(r'\b(fill|stroke)="(?!none)[^"]*"', svg)
        assert "style=" not in svg
    assert not (_WEB / "static" / "vendor" / "chart.umd.min.js").exists()
    assert not (_WEB / "static" / "metrics.js").exists()


async def test_each_chart_points_at_the_table_with_its_figures(client, session_factory):
    html = await _page(client, session_factory, [_llm_event(model="m1", mode="code")])
    for svg in (s for s in _svgs(html) if 'class="chart-svg' in s):
        table_id = re.search(r'aria-describedby="([\w-]+)"', svg).group(1)
        assert re.search(rf'<table[^>]*id="{table_id}"', html), table_id


def _dot_heights(svg: str, series: str) -> list[float]:
    """How far up the plot each day's dot sits (0 = baseline, 100 = top)."""
    ys = re.findall(rf'<path class="chart-dot [^"]*{series}" d="M[\d.]+,([\d.]+)h0"', svg)
    return [round(100 - float(y), 2) for y in ys]


async def test_daily_chart_puts_tokens_and_cost_on_one_plot_with_an_axis_each(client, session_factory):
    html = await _page(
        client,
        session_factory,
        [
            _llm_event(created_at=_days(3)[0], tin=1000, tout=0, cost=0.5),
            _llm_event(created_at=_days(3)[1], tin=4000, tout=0, cost=0.1),
            _llm_event(created_at=_days(3)[2], tin=2000, tout=0, cost=0.2),
        ],
    )
    daily = next(s for s in _svgs(html) if "chart-daily" in s)
    # Each series against the top of its own axis: 4k tokens fills the token
    # axis exactly, the busiest cost ($0.50) sits under a "nice" $0.60.
    assert _dot_heights(daily, "series-tokens") == [25.0, 100.0, 50.0]
    assert _dot_heights(daily, "series-cost") == [83.33, 16.67, 33.33]
    # One smooth line per series, each over its own area.
    for series in ("tokens", "cost"):
        assert len(re.findall(rf'<path class="chart-line chart-line-{series} series-{series}" d="M[^"]+C', daily)) == 1
        assert len(re.findall(rf'<path class="chart-area chart-area-{series} series-{series}" d="M[^"]+Z"', daily)) == 1
    assert "<rect class=\"chart-bar" not in daily
    titles = [unescape(t) for t in re.findall(r"<title>(.*?)</title>", daily)]
    assert titles == [
        "2026-09-20: 1k tokens, $0.5000",
        "2026-09-21: 4k tokens, $0.1000",
        "2026-09-22: 2k tokens, $0.2000",
    ]
    summary = unescape(re.search(r'aria-label="([^"]+)"', daily).group(1))
    assert "highest tokens 4k on 2026-09-21" in summary and "highest cost $0.5000 on 2026-09-20" in summary
    # Two axes of five ticks each, top down, so the gridlines are shared.
    def axis(cls: str) -> list[str]:
        ticks = re.search(rf'class="chart-yaxis {cls}"[^>]*>(.*?)</div>', html).group(1)
        return re.findall(r"<span>(.*?)</span>", ticks)

    assert axis("axis-tokens") == ["4k", "3k", "2k", "1k", "0"]
    assert axis("axis-cost") == ["$0.6", "$0.45", "$0.3", "$0.15", "$0"]
    # The legend toggles are real checkboxes, checked by default.
    for series in ("tokens", "cost"):
        assert re.search(rf'<input type="checkbox" class="series-toggle toggle-{series}" checked>', html)
    # The same figures as a table, newest day first, closed and unpaged.
    table = re.search(r'<table[^>]*id="table-daily".*?</table>', html, re.DOTALL).group(0)
    assert re.findall(r'<td class="bd-name">([\d-]+)</td>', table) == ["2026-09-22", "2026-09-21", "2026-09-20"]
    assert "$0.1000" in table
    assert '<details class="chart-table" id="daily-table">' in html
    assert "chart-table-pager" not in html


def test_quiet_days_are_zeros_on_the_chart_but_not_rows_in_the_table():
    from src.web.presenters.charts import day_table, daily

    days = [
        {"day": "2026-09-28", "tokens": 100, "cost": 1.0},
        {"day": "2026-10-01", "tokens": 300, "cost": 0.5},
    ]
    chart = daily(days)
    assert [s["title"].split(":")[0] for s in chart["slots"]] == ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]
    assert [s["tokens"][1] for s in chart["slots"]][1:3] == ["100", "100"]
    assert "2 active days" in chart["summary"]
    assert [r["day"] for r in day_table(days, 1)["rows"]] == ["2026-10-01", "2026-09-28"]


def _curve_ys(path: str) -> list[tuple[float, list[float]]]:
    """Each cubic segment's end-point y values and the y of its whole curve,
    sampled, so a test can see where it goes between the points."""
    nums = [float(v) for v in re.findall(r"-?[\d.]+", path)]
    y0, rest = nums[1], nums[2:]
    out = []
    for i in range(0, len(rest), 6):
        _, c1, _, c2, _, y1 = rest[i : i + 6]
        ys = [(1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t**2 * c2 + t**3 * y1 for t in (k / 20 for k in range(21))]
        out.append(((y0, y1), ys))
        y0 = y1
    return out


def test_the_line_is_smooth_but_never_swings_past_its_points():
    from src.web.presenters.charts import daily

    # A busy day between quiet ones: a plain spline would dip below zero
    # (below the baseline at y=100) next to the peak.
    values = [0, 0, 900, 0, 50, 400, 380, 0]
    days = [{"day": f"2026-09-{i + 10}", "tokens": v, "cost": 0} for i, v in enumerate(values)]
    line = daily(days)["tokens"]["line"]
    assert line.startswith("M5,100 C")
    for (a, b), ys in _curve_ys(line):
        assert min(a, b) - 1e-6 <= min(ys) and max(ys) <= max(a, b) + 1e-6, (a, b, ys)


def test_a_single_day_is_a_dot_without_a_line_area():
    from src.web.presenters.charts import daily

    chart = daily([{"day": "2026-09-10", "tokens": 4, "cost": 0.1}])
    assert chart["tokens"]["area"] == "" and chart["tokens"]["line"] == "M5,0"
    assert chart["slots"][0]["tokens"] == ("5", "0")
    assert chart["dense"] is False


def test_dots_show_only_under_the_pointer_on_a_long_range():
    from src.web.presenters.charts import DOT_LIMIT, daily

    def days(n):
        return [{"day": (datetime(2026, 1, 1) + timedelta(days=i)).date().isoformat(), "tokens": 1, "cost": 0} for i in range(n)]

    assert daily(days(DOT_LIMIT))["dense"] is False
    assert daily(days(DOT_LIMIT + 1))["dense"] is True


def test_day_table_pages_newest_first_and_clamps_the_page():
    from src.web.presenters.charts import TABLE_PAGE, day_table

    days = [{"day": (datetime(2026, 1, 1) + timedelta(days=i)).date().isoformat(), "tokens": i, "cost": 0} for i in range(40)]
    first = day_table(days, 1)
    assert first["page_count"] == 3 and len(first["rows"]) == TABLE_PAGE
    assert first["rows"][0]["day"] == "2026-02-09" and first["pages"] == [1, 2, 3]
    last = day_table(days, 99)
    assert last["page"] == 3 and [r["day"] for r in last["rows"]][-1] == "2026-01-01"
    assert day_table(days, -4)["page"] == 1
    assert day_table([], 1) == {"rows": [], "page": 1, "page_count": 1, "pages": [1]}


async def test_the_daily_table_pager_keeps_the_period_and_opens_the_table(client, session_factory):
    base = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    events = [_llm_event(created_at=base + timedelta(days=i), tin=1000, tout=0) for i in range(20)]
    async with session_factory() as s:
        await _seed_user(s)
        s.add_all(events)
        await s.commit()
    _override_web_user(client.app)
    try:
        plain = client.get("/app/metrics?period=all").text
        paged = client.get("/app/metrics?period=all&day_page=2").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    # A plain visit: page 1, closed, the pager links to page 2 of the same period.
    assert '<details class="chart-table" id="daily-table">' in plain
    assert 'href="/app/metrics?period=all&amp;day_page=2#daily-table" rel="next"' in plain
    rows = re.findall(r'<td class="bd-name">([\d-]+)</td>', plain)
    assert rows[0] == "2026-01-20" and len(rows) == 14
    # Following the pager: the older days, and the table opens.
    assert '<details class="chart-table" id="daily-table" open>' in paged
    table = re.search(r'<table[^>]*id="table-daily".*?</table>', paged, re.DOTALL).group(0)
    assert re.findall(r'<td class="bd-name">([\d-]+)</td>', table) == [f"2026-01-{d:02d}" for d in range(6, 0, -1)]
    assert '<span class="pager-num current" aria-current="page">2</span>' in paged


def test_axis_top_is_a_nice_number_just_above_the_peak():
    from src.web.presenters.charts import _axis_top

    assert _axis_top(0) == 0
    assert _axis_top(4000) == 4000
    assert _axis_top(253_700_000) == 320_000_000
    assert _axis_top(82.53) == 100


def test_day_labels_thin_out_on_a_long_period():
    from src.web.presenters.charts import daily

    days = [{"day": f"2026-08-{i + 1:02d}", "tokens": 1, "cost": 0} for i in range(30)]
    labels = [s["label"] for s in daily(days)["slots"]]
    assert sum(1 for label in labels if label) <= 12
    assert labels[0] == "08-01"
    # A phone hides every other label, so at most six remain there.
    kept = [s["label"] for s in daily(days)["slots"] if s["label"] and not s["minor"]]
    assert kept[0] == "08-01" and len(kept) <= 6


async def test_ranked_bars_fold_the_tail_and_escape_names(client, session_factory):
    events = [_llm_event(model=f"model-{i}", tin=1000 * (12 - i), tout=0) for i in range(11)]
    events.append(_llm_event(model="<script>alert(1)</script>", tin=50000, tout=0))
    html = await _page(client, session_factory, events)
    models = next(s for s in _svgs(html) if "chart-models" in s)
    assert "<script>" not in models and "&lt;script&gt;" in models
    labels = [unescape(t) for t in re.findall(r'<text class="chart-label"[^>]*>(.*?)</text>', models)]
    # The eight biggest, then everything else as one row.
    assert len(labels) == 9 and labels[0] == "<script>alert(1)</script>"
    assert labels[-1] == "4 others"
    widths = [float(w) for w in re.findall(r'<rect class="chart-bar[^"]*"[^>]*width="([\d.]+)%"', models)]
    assert widths[0] == max(widths)
    assert widths[1] < widths[0]


async def test_no_charts_without_data(client, session_factory):
    html = await _page(client, session_factory, [])
    assert not [s for s in _svgs(html) if 'class="chart-svg' in s]
