# UI-5d: metrics charts as server-rendered inline SVG

Plan: `ai_plans/2026-09-27_ui-modernization.md`, section 3.4 (step 5 of section 5).
Branch: `feat/ui-5d-cloud-svg-charts`, stacked on `feat/ui-4d-cloud-timeline`. Everything is
in `self-hosted-cloudapi/` (plus one table in `docs/08-cloud.md`).

## What

- The three Chart.js canvases are gone, and with them `static/vendor/chart.umd.min.js`
  (290 KB), `static/metrics.js` and the `#metrics-data` JSON island. Nothing else used
  them. `metrics_service` no longer builds the `chart` payload (the characterization
  fixture drops that key; every other figure is unchanged).
- `src/web/presenters/charts.py` computes the geometry; `metrics.html` draws it as inline
  SVG, like the grade and kind bars:
  - **Tokens per day** and **cost per day**: two bar charts on one time axis (a
    `viewBox` of 10-unit day slots, stretched with `preserveAspectRatio="none"`), each bar
    scaled to the busiest day (at least 1% so an active day stays visible), a full-height
    transparent hit area and a `<title>` per day. The old chart put cost on a second y
    axis over the token bars; two scales on one plot invite reading a crossing as
    meaningful, so they are now two charts sharing the x labels.
  - **Tokens by model / by mode**: horizontal bars, biggest first, name and value on one
    line with the bar under them. No `viewBox`, bar widths in percent, so the text keeps
    its size at any width, including a phone. The eight biggest rows are shown and the
    rest fold into one "N others" row.
- Colour only from CSS classes (`.chart-bar-tokens`, `.chart-bar-cost`, `.chart-bar-rank`,
  `.chart-label`, `.chart-axis`...) that read the tokens: the charts follow the light and
  dark themes and print; the markup carries no `fill`, `stroke` or `style`.
- Accessibility: every chart is `role="img"` with an `aria-label` summary (range, number
  of days or rows, the highest value) and `aria-describedby` pointing at the table with
  the same figures: the model and mode breakdown tables (now with ids) and a new daily
  table behind "Show as a table".
- The categorical `--cat-N` tokens 4c added for the Chart.js doughnuts are removed again
  (one hue per chart now; the rows are labelled).

## Deviations

- The model and mode doughnuts became ranked bars rather than SVG doughnuts: shares of a
  handful of named rows compare better by length than by angle, and the bars need no
  legend.
- Days with no activity are not drawn as empty slots (the old chart did the same: it
  plotted the active days only).

## Tests

- `tests/test_web_metrics_svg.py` (5): no Chart.js, script, canvas or island; four
  `role="img"` charts, no colour or style in the markup, the files deleted; every chart
  points at an existing table; bar heights and titles scaled to the busiest day for both
  daily charts and the daily table; ranked rows fold after eight, escape names, widths
  proportional; no chart without data.
- Updated for the removal: `test_cloud_web_perf` (gzip and cache tests on the socket.io
  bundle), `test_json_islands` (hostile model and mode names now checked as escaped page
  text), `test_formatting_call_sites`, `test_web_metrics`, `test_web_light_theme` (chart
  classes read tokens), the characterization fixture; `metrics_theme_checks.html` deleted.
- Full cloudapi suite at the end of the stack: 941 passed, 1 xfailed.
- Screenshots of the metrics page in dark and light.
