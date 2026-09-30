"""Geometry for the metrics page's charts, drawn as inline SVG by the template.

The charts used to be Chart.js canvases (a 290 KB script, drawn after load).
Server-rendered SVG needs no script, prints, and follows the theme: the
template gives every mark a class and the stylesheet colours it from the
tokens, so no colour is ever written into the markup.

Two forms:

- ``daily``: tokens and cost per day on one plot, one slot per active day.
  Each series has its own y axis (tokens on the left, cost on the right), both
  cut into the same four intervals so they share the gridlines. The bars
  overlap and are semi-transparent (tokens wide, cost narrower inside it), and
  the legend's checkboxes hide either series with CSS alone.
- ``ranked``: horizontal bars, biggest first, for tokens by model or mode.
  The eight biggest rows are shown and the rest fold into one "N others"
  row, so a long tail does not push the chart off the card.

Every bar carries a ``<title>`` (the hover), and every chart a one-line
summary for ``aria-label``; the same figures are in a table the chart points
at with ``aria-describedby``.
"""

import math

from src.utils.format import fmt_cost, fmt_tokens

# Daily chart: each day is a 10-unit slot of a 100-unit-high viewBox that
# the stylesheet stretches to the card (preserveAspectRatio="none"). The token
# bar is 8 units wide (a 2-unit gap), the cost bar 4 units, centred on it.
DAY_SLOT = 10
TOKENS_BAR = 8
COST_BAR = 4
PLOT_HEIGHT = 100
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


def _height(value: float, peak: float) -> float:
    if peak <= 0 or value <= 0:
        return 0.0
    # A day with activity stays visible however small it is next to the peak.
    return max(round(PLOT_HEIGHT * value / peak, 2), 1.0)


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


def _bar(slot: int, width: int, value: float, top: float) -> dict:
    h = _height(value, top)
    return {"x": slot * DAY_SLOT + (DAY_SLOT - width) / 2, "width": width, "y": round(PLOT_HEIGHT - h, 2), "height": h}


def _ticks(top: float, fmt) -> list[str]:
    """Axis labels from the top down, so they read in the order they are drawn."""
    return [fmt(top * i / AXIS_STEPS) for i in range(AXIS_STEPS, -1, -1)] if top > 0 else []


def daily(days: list[dict]) -> dict:
    """Tokens and cost per day from metrics_service's ``by_day``, on one plot."""
    tokens = [d["tokens"] or 0 for d in days]
    costs = [d["cost"] or 0 for d in days]
    tokens_top = _axis_top(max(tokens, default=0))
    cost_top = _axis_top(max(costs, default=0))
    every = max(math.ceil(len(days) / DAY_LABELS), 1)
    slots = []
    for i, (d, t, c) in enumerate(zip(days, tokens, costs)):
        slots.append(
            {
                "slot_x": i * DAY_SLOT,
                "tokens": _bar(i, TOKENS_BAR, t, tokens_top),
                "cost": _bar(i, COST_BAR, c, cost_top),
                # "2026-09-28" -> "09-28": the year is in the table and the hover.
                "label": d["day"][5:] if i % every == 0 else "",
                "title": f"{d['day']}: {fmt_tokens(t)} tokens, {fmt_cost(c)}",
            }
        )
    if days:
        summary = f"Tokens and cost per day, {days[0]['day']} to {days[-1]['day']}, {len(days)} active days"
        for what, values, fmt in (("tokens", tokens, fmt_tokens), ("cost", costs, fmt_cost)):
            peak = max(values)
            if peak > 0:
                summary += f"; highest {what} {fmt(peak)} on {days[values.index(peak)]['day']}"
    else:
        summary = "Tokens and cost per day: no data"
    return {
        "width": max(len(days), 1) * DAY_SLOT,
        "height": PLOT_HEIGHT,
        "slots": slots,
        "gridlines": [round(PLOT_HEIGHT * i / AXIS_STEPS, 2) for i in range(AXIS_STEPS)],
        "tokens_ticks": _ticks(tokens_top, fmt_tokens),
        "cost_ticks": _ticks(cost_top, _axis_cost),
        "summary": summary,
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


def metrics_charts(metrics: dict) -> dict:
    return {
        "daily": daily(metrics["by_day"]),
        "models": ranked(metrics["by_model"], "model"),
        "modes": ranked(metrics["by_mode"], "mode"),
    }
