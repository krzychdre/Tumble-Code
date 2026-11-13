# Cloud API: "Client" filter on the problem report, the task list and the dataset

Status: done on `feat/cloudapi-client-kind-filters` (stacked on `feat/cloudapi-client-kind`)
Related plans: [2026-10-03_11-00_cli-cloud-login-overview.md](2026-10-03_11-00_cli-cloud-login-overview.md) (overview,
lives on `feat/client-kind-telemetry`), [2026-10-03_11-30_cloudapi-client-kind.md](2026-10-03_11-30_cloudapi-client-kind.md)
(the columns, the migration, the metrics page)
Touched: `self-hosted-cloudapi/src/services/problems/{base,filters,collect,aggregate,service,views}.py`,
`services/problem_brief.py`, `routers/web_diagnostics.py`, `web/templates/diagnostics.html`,
`web/presenters/task_list.py`, `web/presenters/task_rows.py`, `routers/web_tasks.py`, `web/templates/tasks_list.html`,
`web/templates/task_detail.html`, `services/dataset_export.py`, `services/dataset_overview.py`,
`routers/web_dataset.py`, `web/templates/dataset.html`, `web/static/app.css`, `docs/08-cloud.md`, tests

## Problem

The branch below stores which client sent every record (`client_kind`, `vscode` or `cli`) and filters the metrics
page by it. The other pages that list the user's records still mixed both clients with no way to tell them apart.

## Fix

The same query parameter everywhere, `client=vscode|cli` (absent or unknown means both), label "Client", values
"VS Code" and "CLI" (`services/client_kind.CLIENT_LABELS`, `parse_client`).

### `/app/diagnostics`

- `Occurrence.client` (default `vscode`), filled in `collect.py`: a report from `error_reports.client_kind`, a
  telemetry occurrence from `telemetry_events.client_kind`, a conversation occurrence from its task's
  `tasks.client_kind` (one chunked `SELECT id, client_kind FROM tasks WHERE id IN (...)` over the tasks that have
  error messages, like the requests lookup next to it).
- `ProblemFilter.client`, in `FILTER_FIELDS` (between `source` and `q`) and `FILTER_LABELS`; `parse` drops unknown
  values, `label` says "VS Code"/"CLI", `matches` compares. Because every URL, chip, the cleared view and the brief
  header (`describe`) are built from `FILTER_FIELDS`, the chip, the period tabs, the brief links and
  "Filters: client 'CLI'." in the Markdown brief needed no code of their own.
- The filter form gets a "Client" select fed by `options["client"]` (counts from the unfiltered period, VS Code then
  CLI, like the sources).
- The model fit compares like with like: with a client filter, `_request_counts` counts only that client's
  `LLM Completion` events (SQL condition on the column).
- A brief's sample header says "from the CLI" for a CLI sample; VS Code samples are unchanged, so existing briefs
  read as before.

### Task list `/app` and the task page

- `ListView.client` (in `_FILTER_FIELDS`, so the pager, the chips, "Clear all", the hidden fields of the bulk form
  and the redirect after a bulk delete carry it; `_VIEW_FIELDS` in `routers/web_tasks.py` too). SQL condition
  `tasks.client_kind = :client` in `conditions`.
- A "Client" select in the filter panel, a "Client: CLI" chip, and a neutral `CLI` badge on CLI rows only (VS Code is
  nearly every row, so marking it would be noise). The badge never shrinks (`.cell-meta .badge-client`).
- The task page shows "Client: VS Code" or "Client: CLI" under the workspace line (owner page only; the shared view
  does not pass it).

### Dataset `/app/dataset`

- `dataset_overview(..., client)` and `recent_tasks(..., client)` add `llm_exchanges.client_kind = :client`.
- The page gets the same "All clients / VS Code / CLI" control as the metrics page; the period links keep the client
  and the export form carries it as a hidden field.
- `ExportOptions.client` (read from the query string) filters `task_ids`, which both the export and the audit go
  through. Deliberately per task, not per exchange: a task is recorded by one client only, so a task-level choice is
  exact and needs no change to the reconstruction's `Exchange`.

## Tests

`tests/test_client_filters.py`: filter parsing, labels and `describe`; the pure aggregation and its options; every
source carrying its client (reports, events, conversation errors via the task) and the legacy cutoff still
applying; the model fit's request counts following the filter; the diagnostics page (chip, select, links kept,
brief header and sample note, unknown value ignored); the task list filter (SQL), badge, select, chip, bulk delete
redirect keeping the filter, the task page; the dataset page links and hidden field and the export filter.

Updated pins, each only for the new parameter or field: `tests/test_route_table.py` (`client` on `/app`,
`/app/diagnostics*` and `/app/dataset`), `tests/test_web_presenters.py` (the row view-model gains `client`; the
fixture's root run is a CLI task so both values are pinned).

Verification: `cd self-hosted-cloudapi && uv run pytest -q` and `make lint`.

## Notes

- api image rebuild needed (together with the branch below; the migration lives there).
- A row built in memory and never flushed has no column default yet, so the row presenter reads a missing
  `client_kind` as `vscode`.
