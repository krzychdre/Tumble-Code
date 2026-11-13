# Daily chart with one active day draws only a dot

**Status:** fixed on `fix/daily-chart-single-day`
**Touched:** `self-hosted-cloudapi/src/web/presenters/charts.py`, `self-hosted-cloudapi/tests/test_web_metrics_svg.py`

## Symptom

On `/app/metrics`, "Tokens & cost per day" for a period with a single active day
(e.g. the first day of use, or "Today") showed two lone dots in the middle of an
empty plot, one per series, with no line or area. Hard to read as a chart.

## Cause

`daily()` gets one slot per calendar day from the first active day to the last.
With one day there is one point, and `_series` drew a line and area only from
two points up.

## Fix

With exactly one point, `_series` draws the series' level as a flat line across
the whole slot (the whole plot, since it is the only slot), with its area under
it; the dot stays in the middle, under the date.

Rejected first attempt: putting a zero day in front of the single day so the
curve could rise from it. The owner rejected it: the day before is not known to
be zero (with the "Today" period it is simply outside the range), so the chart
would show invented data.
