"""The metrics charts as server-rendered inline SVG (UI plan 3.4).

They used to be three Chart.js canvases (a 290 KB script, drawn after load,
with a dual-axis tokens-and-cost chart). Now the page itself carries them,
like the grade and kind bars: no script, they follow the theme through CSS
classes (no colour in the markup), they print, and each is role="img" with
a summary, linked to the table that holds the same figures.
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
    # Tokens per day and cost per day are two charts (never one with two
    # y-axes), then models and modes.
    assert len(charts) == 4
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


async def test_daily_bars_are_scaled_to_the_busiest_day(client, session_factory):
    html = await _page(
        client,
        session_factory,
        [
            _llm_event(created_at=_days(3)[0], tin=1000, tout=0, cost=0.5),
            _llm_event(created_at=_days(3)[1], tin=4000, tout=0, cost=0.1),
            _llm_event(created_at=_days(3)[2], tin=2000, tout=0, cost=0.2),
        ],
    )
    tokens = next(s for s in _svgs(html) if "chart-daily-tokens" in s)
    heights = [float(h) for h in re.findall(r'<rect class="chart-bar[^"]*"[^>]*height="([\d.]+)"', tokens)]
    assert heights == [25.0, 100.0, 50.0]
    titles = [unescape(t) for t in re.findall(r"<title>(.*?)</title>", tokens)]
    assert titles == ["2026-09-20: 1k tokens", "2026-09-21: 4k tokens", "2026-09-22: 2k tokens"]
    summary = unescape(re.search(r'aria-label="([^"]+)"', tokens).group(1))
    assert "4k" in summary and "2026-09-21" in summary
    cost = next(s for s in _svgs(html) if "chart-daily-cost" in s)
    heights = [float(h) for h in re.findall(r'<rect class="chart-bar[^"]*"[^>]*height="([\d.]+)"', cost)]
    assert heights == [100.0, 20.0, 40.0]
    # The same figures as a table.
    table = re.search(r'<table[^>]*id="table-daily".*?</table>', html, re.DOTALL).group(0)
    assert "2026-09-21" in table and "$0.1000" in table


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
    widths = [float(w) for w in re.findall(r'<rect class="chart-bar[^"]*"[^>]*width="([\d.]+)"', models)]
    assert widths[0] == max(widths)
    assert widths[1] < widths[0]


async def test_no_charts_without_data(client, session_factory):
    html = await _page(client, session_factory, [])
    assert not [s for s in _svgs(html) if 'class="chart-svg' in s]
