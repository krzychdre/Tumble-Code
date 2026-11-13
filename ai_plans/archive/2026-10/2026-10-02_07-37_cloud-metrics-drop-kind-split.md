# Cloud metrics: drop the "Where the tokens went" panel

Status: done, on branch `feat/cloud-metrics-drop-kind-split` (not merged yet)

Related: `2026-10-02_07-40_cloud-metrics-line-chart.md` (stacked on this branch)

Touched:

- `self-hosted-cloudapi/src/web/templates/metrics.html`
- `self-hosted-cloudapi/src/web/static/app.css`
- `self-hosted-cloudapi/tests/test_side_call_metrics.py`
- `self-hosted-cloudapi/tests/test_formatting_call_sites.py`

## Why

The owner (2026-10-02, with a screenshot of the panel): "Nie widzę potrzeby "Where tokens went", jakoś nie widzę w tym
wartości". On the real corpus the panel is two rows, "Conversation" 881.1M tokens and $190.37 against "Memory recall"
117.9k tokens and no cost: one full bar and one empty one, with nothing a reader would act on.

## Change

- The `kind-split` section is gone from `metrics.html`, with its note about calls that came back without usage
  figures, and the `.kind-*` rules (and their phone media query) are gone from `app.css`.
- `metrics_service` still computes `by_kind` and `unreported`. They are pinned by the characterization fixture and by
  `test_side_call_metrics.py` / `test_telemetry_vocab.py` as aggregation behaviour; removing the computation would churn
  the golden fixture for a few dictionary entries. If nothing reads them again, they can go in a later cleanup.

## Tests

- `test_metrics_page_shows_the_split_and_the_indexing_tile` became
  `test_metrics_page_shows_the_indexing_tile_and_no_kind_split`: it asserts the panel is absent and the indexing tile
  is still there.
- `test_the_metrics_page_prints_its_figures` lost its two `kind-num` assertions; the same rounding tie ($0.03125 ->
  "$0.0313") is still asserted through the by-model table.
