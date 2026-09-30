# Cloud metrics: tokens and cost per day on one chart

Branch: `feat/cloud-metrics-combined-daily-chart`. Everything is in `self-hosted-cloudapi/`.

## Why

UI-5d (`2026-09-28_ui-5d-cloud-svg-charts.md`) split the daily chart into two stacked
bar charts on one time axis, to avoid two y axes on one plot. In use it read as
unnatural: two strips with no scale, only a "max" figure each, and the eye has to jump
between them to relate a day's tokens to its cost. The owner asked for one plot with two
y axes, semi-transparent series, and a way to switch each series on and off.

## What

- `presenters/charts.py`: `daily(days)` now returns one plot with both series.
    - Each series has its own axis top, a "nice" number (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10
      times a power of ten) just above the peak, cut into four steps. Because both axes
      have four steps, their gridlines coincide, so one set of gridlines serves both.
    - Per day: a token bar (8 of the 10-unit slot) and a cost bar (4 units, centred), each
      scaled to its own axis; one `<title>` with both figures; a `MM-DD` label, thinned to
      at most 12 labels on a long period.
    - Tick labels: tokens with `fmt_tokens`, cost with a short `$25` / `$0.15` form.
- `metrics.html`: one `role="img"` SVG with dashed gridlines, the two axes as HTML
  columns beside it (text in a `preserveAspectRatio="none"` SVG would stretch), day
  labels under it, and a legend of two real checkboxes.
- `app.css`: bars semi-transparent (tokens 0.55, cost 0.8, cost drawn on top); axis
  labels in the series colour; clearing a checkbox hides that series and its axis labels
  through `:has()`, so the toggle needs no script and fits the strict CSP. The native
  checkbox is visually hidden but focusable, with a focus ring on its swatch.

## Tests

`tests/test_web_metrics_svg.py`: three chart SVGs instead of four; both series' heights
against their own axis tops; both tick columns; the legend checkboxes; `_axis_top` on
the real 253.7M / $82.53 peaks; day-label thinning.

## Deploy

Rebuild and restart the `api` image (`docker compose up -d --build api` in
`self-hosted-cloudapi/`).
