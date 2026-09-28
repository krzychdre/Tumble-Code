"""Geometry for the metrics page's charts, drawn as inline SVG by the template.

The charts used to be Chart.js canvases (a 290 KB script, drawn after load).
Server-rendered SVG needs no script, prints, and follows the theme: the
template gives every mark a class and the stylesheet colours it from the
tokens, so no colour is ever written into the markup.

Two forms, both one series each (so no legend; the chart title names it):

- ``daily``: one bar per active day, its height the day's value against the
  busiest day. Tokens and cost are two of these, never one chart with two
  y-axes (two scales on one plot invite reading a crossing as meaningful).
- ``ranked``: horizontal bars, biggest first, for tokens by model or mode.
  The eight biggest rows are shown and the rest fold into one "N others"
  row, so a long tail does not push the chart off the card.

Every bar carries a ``<title>`` (the hover), and every chart a one-line
summary for ``aria-label``; the same figures are in a table the chart points
at with ``aria-describedby``.
"""

from typing import Callable

from src.utils.format import fmt_cost, fmt_tokens

# Daily chart: each day is a 10-unit slot of a 100-unit-high viewBox that
# the stylesheet stretches to the card (preserveAspectRatio="none"), so a bar
# is 8 units wide with a 2-unit gap.
DAY_SLOT = 10
DAY_GAP = 2
PLOT_HEIGHT = 100

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


def daily(days: list[dict], key: str, unit: str) -> dict:
    """Bars for ``key`` ("tokens" or "cost") of metrics_service's ``by_day``."""
    fmt: Callable[[float], str] = fmt_tokens if key == "tokens" else fmt_cost
    values = [d[key] or 0 for d in days]
    peak = max(values, default=0)
    bars = []
    for i, (d, value) in enumerate(zip(days, values)):
        h = _height(value, peak)
        bars.append(
            {
                "slot_x": i * DAY_SLOT,
                "x": i * DAY_SLOT + DAY_GAP / 2,
                "width": DAY_SLOT - DAY_GAP,
                "y": round(PLOT_HEIGHT - h, 2),
                "height": h,
                "title": f"{d['day']}: {fmt(value)}{unit}",
            }
        )
    busiest = days[values.index(peak)]["day"] if days and peak > 0 else None
    what = "Tokens" if key == "tokens" else "Cost"
    if days:
        summary = f"{what} per day, {days[0]['day']} to {days[-1]['day']}, {len(days)} active days"
        summary += f"; highest {fmt(peak)}{unit} on {busiest}" if busiest else "; all zero"
    else:
        summary = f"{what} per day: no data"
    return {
        "width": max(len(days), 1) * DAY_SLOT,
        "height": PLOT_HEIGHT,
        "bars": bars,
        "peak": fmt(peak),
        "first": days[0]["day"] if days else "",
        "last": days[-1]["day"] if days else "",
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
        "tokens": daily(metrics["by_day"], "tokens", " tokens"),
        "cost": daily(metrics["by_day"], "cost", ""),
        "models": ranked(metrics["by_model"], "model"),
        "modes": ranked(metrics["by_mode"], "mode"),
    }
