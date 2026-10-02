"""Geometry for the metrics page's charts, drawn as inline SVG by the template.

The charts used to be Chart.js canvases (a 290 KB script, drawn after load).
Server-rendered SVG needs no script, prints, and follows the theme: the
template gives every mark a class and the stylesheet colours it from the
tokens, so no colour is ever written into the markup.

Two forms:

- ``daily``: tokens and cost per day on one plot, one slot per calendar day
  from the first active day to the last (quiet days are zeros, so the line
  does not skip over them). Each series is a smooth line over a faint area,
  with its own y axis (tokens on the left, cost on the right), both cut into
  the same four intervals so they share the gridlines. The legend's
  checkboxes hide either series with CSS alone. Its table is paged
  (``day_table``), newest day first, so "All time" does not list a year.
- ``ranked``: horizontal bars, biggest first, for tokens by model or mode.
  The eight biggest rows are shown and the rest fold into one "N others"
  row, so a long tail does not push the chart off the card.

Every day or bar carries a ``<title>`` (the hover), and every chart a one-line
summary for ``aria-label``; the same figures are in a table the chart points
at with ``aria-describedby``.
"""

import math
from datetime import date, timedelta

from src.utils.format import fmt_cost, fmt_tokens
from src.utils.pagination import page_window

# Daily chart: each day is a 10-unit slot of a 100-unit-high viewBox that
# the stylesheet stretches to the card (preserveAspectRatio="none"); a day's
# point sits in the middle of its slot, under its label.
DAY_SLOT = 10
PLOT_HEIGHT = 100
# Up to this many days every point is drawn as a dot; past it the dots would
# merge into a second, thicker line, so a dot shows only under the pointer.
DOT_LIMIT = 45
# Rows of the daily table per page: two weeks, so "7 days" is one page.
TABLE_PAGE = 14
# Both y axes have this many intervals, so their gridlines coincide.
AXIS_STEPS = 4
# At most this many day labels under the plot; the rest are left blank.
DAY_LABELS = 12
# Tick steps are one of these times a power of ten.
_NICE = (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10)

# Ranked chart: no viewBox, so text keeps its real size at any width. Each
# row is the name (left) and the value (right) on one line, the bar under
# them, its width a percentage of the chart's width.
RANK_ROW = 34
RANK_LABEL_CHARS = 40
RANK_LIMIT = 8


def _axis_top(peak: float) -> float:
    """The smallest "nice" top of the axis that fits ``peak`` in AXIS_STEPS steps."""
    if peak <= 0:
        return 0.0
    raw = peak / AXIS_STEPS
    power = 10 ** math.floor(math.log10(raw))
    step = next(m for m in _NICE if raw <= m * power * (1 + 1e-9)) * power
    return step * AXIS_STEPS


def _axis_cost(dollars: float) -> str:
    """A cost tick, without fmt_cost's four fixed places: "$25", "$0.15"."""
    return "$" + f"{dollars:.4f}".rstrip("0").rstrip(".")


def _ticks(top: float, fmt) -> list[str]:
    """Axis labels from the top down, so they read in the order they are drawn."""
    return [fmt(top * i / AXIS_STEPS) for i in range(AXIS_STEPS, -1, -1)] if top > 0 else []


def calendar(days: list[dict]) -> list[dict]:
    """``by_day`` with the quiet days between the first and the last put back
    as zeros. metrics_service lists only the days with activity; drawn side by
    side they would slide every later point under the wrong date, and a line
    would run straight across a week nobody worked."""
    if not days:
        return []
    have = {d["day"]: d for d in days}
    first, last = date.fromisoformat(days[0]["day"]), date.fromisoformat(days[-1]["day"])
    out = []
    for i in range((last - first).days + 1):
        day = (first + timedelta(days=i)).isoformat()
        out.append(have.get(day) or {"day": day, "tokens": 0, "cost": 0.0})
    return out


def _n(v: float) -> str:
    """A coordinate for a path: two places at most, no trailing zeros."""
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _smooth(points: list[tuple[float, float]]) -> str:
    """A path through ``points`` (x ascending) as cubic curves that never
    overshoot: monotone cubic interpolation, the same as d3's curveMonotoneX.

    A plain spline swings below a zero day that follows a busy one, which on
    this chart would draw negative tokens; here the tangent at a point is
    flattened whenever its neighbours are on the same side of it, so every
    curve stays between the two values it joins.
    """
    if not points:
        return ""
    if len(points) == 1:
        return f"M{_n(points[0][0])},{_n(points[0][1])}"
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    n = len(points)
    secants = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    tangents = [0.0] * n
    for i in range(1, n - 1):
        s0, s1 = secants[i - 1], secants[i]
        if s0 * s1 > 0:
            h0, h1 = xs[i] - xs[i - 1], xs[i + 1] - xs[i]
            p = (s0 * h1 + s1 * h0) / (h0 + h1)
            tangents[i] = math.copysign(min(abs(s0), abs(s1), 0.5 * abs(p)), s0)
    # The ends lean as far as the curve next to them allows (d3's slope2).
    tangents[0] = (3 * secants[0] - tangents[1]) / 2 if n > 2 else secants[0]
    tangents[-1] = (3 * secants[-1] - tangents[-2]) / 2 if n > 2 else secants[-1]
    out = [f"M{_n(xs[0])},{_n(ys[0])}"]
    for i in range(n - 1):
        third = (xs[i + 1] - xs[i]) / 3
        out.append(
            f"C{_n(xs[i] + third)},{_n(ys[i] + third * tangents[i])} "
            f"{_n(xs[i + 1] - third)},{_n(ys[i + 1] - third * tangents[i + 1])} "
            f"{_n(xs[i + 1])},{_n(ys[i + 1])}"
        )
    return " ".join(out)


def _series(values: list[float], top: float) -> dict:
    """One series' line, the area under it, and a point per day."""
    points = [
        (i * DAY_SLOT + DAY_SLOT / 2, PLOT_HEIGHT - (PLOT_HEIGHT * v / top if top > 0 else 0))
        for i, v in enumerate(values)
    ]
    line = _smooth(points)
    area = f"{line} L{_n(points[-1][0])},{PLOT_HEIGHT} L{_n(points[0][0])},{PLOT_HEIGHT} Z" if len(points) > 1 else ""
    return {"line": line, "area": area, "points": [(_n(x), _n(y)) for x, y in points]}


def daily(days: list[dict]) -> dict:
    """Tokens and cost per day from metrics_service's ``by_day``, on one plot."""
    days = calendar(days)
    tokens = [d["tokens"] or 0 for d in days]
    costs = [d["cost"] or 0 for d in days]
    tokens_top = _axis_top(max(tokens, default=0))
    cost_top = _axis_top(max(costs, default=0))
    tokens_series = _series(tokens, tokens_top)
    cost_series = _series(costs, cost_top)
    every = max(math.ceil(len(days) / DAY_LABELS), 1)
    slots = []
    for i, (d, t, c) in enumerate(zip(days, tokens, costs)):
        slots.append(
            {
                "slot_x": i * DAY_SLOT,
                "tokens": tokens_series["points"][i],
                "cost": cost_series["points"][i],
                # "2026-09-28" -> "09-28": the year is in the table and the hover.
                "label": d["day"][5:] if i % every == 0 else "",
                # Every other label, which a phone hides: twelve dates do not
                # fit its plot side by side.
                "minor": i % every == 0 and (i // every) % 2 == 1,
                "title": f"{d['day']}: {fmt_tokens(t)} tokens, {fmt_cost(c)}",
            }
        )
    if days:
        active = sum(1 for t, c in zip(tokens, costs) if t or c)
        summary = f"Tokens and cost per day, {days[0]['day']} to {days[-1]['day']}, {active} active days"
        for what, values, fmt in (("tokens", tokens, fmt_tokens), ("cost", costs, fmt_cost)):
            peak = max(values)
            if peak > 0:
                summary += f"; highest {what} {fmt(peak)} on {days[values.index(peak)]['day']}"
    else:
        summary = "Tokens and cost per day: no data"
    return {
        "width": max(len(days), 1) * DAY_SLOT,
        "height": PLOT_HEIGHT,
        "slot": DAY_SLOT,
        "slots": slots,
        "tokens": tokens_series,
        "cost": cost_series,
        "dense": len(days) > DOT_LIMIT,
        "gridlines": [round(PLOT_HEIGHT * i / AXIS_STEPS, 2) for i in range(AXIS_STEPS)],
        "tokens_ticks": _ticks(tokens_top, fmt_tokens),
        "cost_ticks": _ticks(cost_top, _axis_cost),
        "summary": summary,
    }


def day_table(days: list[dict], page: int) -> dict:
    """One page of the daily table: the active days, newest first, TABLE_PAGE
    to a page. An out-of-range ``page`` lands on the nearest real one, as on
    the task list."""
    page_count = max(1, math.ceil(len(days) / TABLE_PAGE))
    page = min(max(page, 1), page_count)
    newest_first = days[::-1]
    return {
        "rows": newest_first[(page - 1) * TABLE_PAGE : page * TABLE_PAGE],
        "page": page,
        "page_count": page_count,
        "pages": page_window(page, page_count),
    }


def _truncate(name: str) -> str:
    return name if len(name) <= RANK_LABEL_CHARS else name[: RANK_LABEL_CHARS - 1] + "…"


def ranked(rows: list[dict], what: str) -> dict:
    """Tokens by ``what`` ("model" or "mode") from ``by_model`` / ``by_mode``,
    already sorted biggest first."""
    shown = [dict(name=r["name"], tokens=r["tokens"]) for r in rows[:RANK_LIMIT]]
    rest = rows[RANK_LIMIT:]
    if rest:
        shown.append(
            {"name": f"{len(rest)} other{'' if len(rest) == 1 else 's'}", "tokens": sum(r["tokens"] for r in rest)}
        )
    peak = max((r["tokens"] for r in shown), default=0)
    items = []
    for i, r in enumerate(shown):
        width = round(100 * r["tokens"] / peak, 2) if peak > 0 and r["tokens"] > 0 else 0.0
        if r["tokens"] > 0:
            width = max(width, 0.5)
        top = i * RANK_ROW
        items.append(
            {
                "label": _truncate(r["name"]),
                "title": f"{r['name']}: {fmt_tokens(r['tokens'])} tokens",
                "value": fmt_tokens(r["tokens"]),
                "text_y": top + 13,
                "bar_y": top + 19,
                "row_y": top,
                "width": width,
            }
        )
    lead = shown[0] if shown else None
    summary = (
        f"Tokens by {what}, {len(rows)} {what}{'' if len(rows) == 1 else 's'}; "
        f"most: {lead['name']}, {fmt_tokens(lead['tokens'])}"
        if lead
        else f"Tokens by {what}: no data"
    )
    return {
        "height": max(len(items), 1) * RANK_ROW,
        "row_height": RANK_ROW,
        "bar_height": 8,
        "rows": items,
        "summary": summary,
    }


def metrics_charts(metrics: dict, day_page: int = 1) -> dict:
    return {
        "daily": daily(metrics["by_day"]),
        "day_table": day_table(metrics["by_day"], day_page),
        "models": ranked(metrics["by_model"], "model"),
        "modes": ranked(metrics["by_mode"], "mode"),
    }
