# Cloud metrics: daily chart as smooth lines, daily table paged

Status: done, on branch `feat/cloud-metrics-line-chart` (stacked on `feat/cloud-metrics-drop-kind-split`, not merged
yet)

Related: `2026-10-02_07-37_cloud-metrics-drop-kind-split.md` (the branch under this one),
`2026-09-30_cloud-metrics-combined-daily-chart.md` (#654, the two-axis bar chart this replaces). Supersedes the
unmerged local branch `fix/cloud-daily-chart-axis` (its calendar gap filling is re-done here on top of #654).

Touched:

- `self-hosted-cloudapi/src/web/presenters/charts.py`
- `self-hosted-cloudapi/src/web/templates/metrics.html`
- `self-hosted-cloudapi/src/web/templates/_pager.html` (new)
- `self-hosted-cloudapi/src/web/templates/tasks_list.html`
- `self-hosted-cloudapi/src/routers/web_metrics.py`
- `self-hosted-cloudapi/src/routers/web_tasks.py`
- `self-hosted-cloudapi/src/web/static/app.css`
- tests: `test_web_metrics_svg.py`, `test_web_light_theme.py`, `test_route_table.py`

## Why

The owner (2026-10-02), looking at "Tokens & cost per day" on "All time": "Wydaje mi się, że wykres liniowy będzie
wygladał lepiej niż słupki. (zaokrąglony - nie ostry)", and "forma tabeli - przy all time będzie pokazywała wszystkie
dni? To trzeba stronicować."

Two more things the screenshot showed:

- The chart had one slot per **active** day (`metrics_service.by_day` lists only days with activity), so 09-13 was
  missing between 09-12 and 09-14. With bars that only mislabels the axis; a line would run straight across the gap as
  if it were one day. The fix sat unmerged on `fix/cloud-daily-chart-axis` since 2026-09-29 and conflicts with #654.
- The table under the chart printed every active day, oldest first.

## Change

Chart (`charts.daily`):

- `calendar()` puts the quiet days between the first and the last active day back as zeros (taken from
  `fix/cloud-daily-chart-axis`). The summary still counts active days only.
- Each series is a line through the day points plus a faint area under it. The line is monotone cubic interpolation
  (`_smooth`, the same algorithm as d3's `curveMonotoneX`): rounded, but a segment never leaves the range between the
  two values it joins. A Catmull-Rom style spline would dip below the baseline next to a busy day that follows a
  zero day, which here would draw negative tokens; `test_the_line_is_smooth_but_never_swings_past_its_points` samples
  every segment to pin that.
- Each day keeps its `<title>` hover group (a translucent column now, since it is drawn over the lines) and has one
  dot per series. A dot is a zero-length path with a round cap and `vector-effect: non-scaling-stroke`, so it stays a
  circle although the SVG is stretched with `preserveAspectRatio="none"`. Past `DOT_LIMIT` (45) days the dots show only
  under the pointer (`.is-dense`), otherwise they merge into a thicker second line.
- The legend's checkboxes still hide a series (line, area, dots and axis) through the existing `series-*` classes.
- Day labels: every other label is marked `minor` and hidden under 640px. With calendar days there are more slots,
  and twelve "09-25" labels ran into each other on a 500px wide screen (they already did with nine).

Table (`charts.day_table`):

- Newest day first, `TABLE_PAGE` = 14 rows (two weeks, so "7 days" is one page), active days only.
- `/app/metrics` takes `day_page`. The pager links keep the period and end in `#daily-table`; the `<details>` opens
  only when `day_page` is in the URL, so a plain visit looks as before. An out-of-range page is clamped like the task
  list's.
- The pager markup is now one macro, `_pager.html`, used by the task list too (its "Go to" form is passed as a
  `{% call %}` body). The task list's unused `has_prev` / `has_next` context went with it.

## Tests

- `test_web_metrics_svg.py`: the bar-height assertion became dot heights (same figures: tokens 25/100/50, cost
  83.33/16.67/33.33), plus one line and one area per series; new tests for calendar zeros vs table rows, no overshoot,
  a single day (a dot, no area), the dense switch, `day_table` paging and clamping, the pager links and the open table
  through the real route, and the phone label thinning.
- `test_web_light_theme.py`: the colour-token check names the new line, area and dot rules.
- `test_route_table.py`: `/app/metrics` has the `day_page` query parameter.
- Full cloudapi suite: 928 passed, 1 failed:
  `test_route_boilerplate.py::test_extension_routes_refuse_a_bad_token[headers3...]`. Not this change: its JWT is
  minted when pytest collects the module, valid for 60 s, so it expires whenever the run reaches it after a minute
  (this run took 115 s on a loaded machine; a clean `main` run took 48 s and passed). Reproduced on clean `main` by
  sleeping 61 s after collection. Fixed on its own branch, `fix/cloudapi-test-jwt-minted-at-collection`.
- Looked at in headless Chrome: dark and light theme, 1400px and 500px wide, a 21-day range with gaps and a 120-day
  range (dense).

## Notes

- `aria-describedby` on the chart points at the table, which now holds one page; the caption says "page N of M,
  newest first" when there is more than one.
- `fix/cloud-daily-chart-axis` can be deleted once this is merged; the live api image still runs it until rebuilt.
