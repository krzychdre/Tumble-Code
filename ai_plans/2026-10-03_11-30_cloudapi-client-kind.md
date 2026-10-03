# Cloud API: which client sent a record (VS Code or the CLI)

Status: done on `feat/cloudapi-client-kind` (based on main)
Related plans: [2026-10-03_11-00_cli-cloud-login-overview.md](2026-10-03_11-00_cli-cloud-login-overview.md) (overview,
lives on `feat/client-kind-telemetry`; its "Shared contract" table is binding),
`2026-10-03_12-30_cloudapi-client-kind-filters.md` (the stacked branch `feat/cloudapi-client-kind-filters`: the other pages' filters)
Touched: `self-hosted-cloudapi/src/services/client_kind.py` (new), `alembic/versions/e7f8a9b0c1d2_client_kind.py`
(new), models `event.py`, `error_report.py`, `llm_exchange.py`, `task.py`, `services/telemetry_service.py`,
`routers/events.py`, `services/error_report_service.py`, `services/exchange_ingest.py`, `schemas/error_report.py`,
`schemas/llm_exchange.py`, `services/metrics_service.py`, `services/quality_overview.py`, `routers/web_metrics.py`,
`web/templates/metrics.html`, `web/static/app.css`, `docs/08-cloud.md`, tests

## Problem

Once the CLI can sign in (other branches of the overview), it sends the same `LLM Completion` events, exceptions,
error reports and LLM exchanges as the extension, because it runs the extension's own bundle. Nothing in the
database said which client a record came from, so the metrics page would silently mix both.

## Fix

### One rule, `services/client_kind.client_kind_from`

A known `clientKind` (`vscode`/`cli`, case and surrounding spaces ignored) wins. Otherwise the editor name decides:
the CLI's fake `vscode` module reports `vscode.env.appName` as `wrapper|cli|cli|<version>`
(`packages/vscode-shim/src/api/create-vscode-api-mock.ts`), so `editorName` starting with `wrapper|cli` is the CLI.
Anything else, including no fields at all, is VS Code. An unknown `clientKind` text is never refused (no 422, no
500); it simply falls through to the editor name. `parse_client` turns a `?client=` value into a kind or None.

### Columns

`client_kind` on `telemetry_events`, `error_reports`, `llm_exchanges` and `tasks`:
`String, NOT NULL, default and server_default "vscode"`.

- NOT NULL with a server default: old rows and old clients need no NULL branch in any reader, and every record from
  before the CLI could sign in really is from VS Code (the backfill corrects the few that are not).
- No index, deliberately. Every reader narrows by user and time first: the metrics reads use
  `ix_telemetry_events_user_type_created (user_id, event_type, created_at)`, the task list `ix_tasks_user_updated`,
  the reports and exchanges their `(user_id, created_at)` indexes. A two-value column can only drop rows those
  indexes already found, and the readers fetch those rows anyway (the metrics page parses every `properties`
  blob in the range). Putting `client_kind` inside the composite would hurt the common, unfiltered read: the
  `ORDER BY created_at` would no longer come from the index. Adding it as a trailing column would let the database
  filter inside the index, but the rows are still read for their payload, so it would only cost writes on the
  hottest table.

### Stamping at ingest

- `record_event` stamps `telemetry_events.client_kind` from the event's properties.
- `report_row` (error reports) and `record_exchange` (LLM exchanges) stamp from the new optional wire fields
  `clientKind`/`clientVersion` (added to both schemas; `clientVersion` stays in the payload only) with the editor
  name as the fallback.
- Tasks: the bridge creates most rows from a chat message, which names no client, so "first writer wins" on the
  task row would freeze most CLI tasks as `vscode`. The rule is instead monotonic: a task row starts as `vscode`
  ("nothing said otherwise yet") and turns `cli` with the first CLI record of its own user, never back (a task lives
  in one client's storage, so it cannot legitimately be both). Three paths feed it:
    - `stamp_task_client` (one guarded `UPDATE ... WHERE client_kind != 'cli' AND user_id = owner`) from every CLI
      telemetry event naming the task, and from a backfill whose `properties` form field names the CLI;
    - `_get_or_create_task` gives a new row the backfill's kind or, failing that, adopts `cli` when the user's
      telemetry for the task already says so (one indexed lookup on `telemetry_events.task_id`, only when the row is
      created), so the order in which bridge, backfill and telemetry arrive does not matter.
      The monotonic `ON CONFLICT` upsert of `task_messages` and the `INSERT ... ON CONFLICT (id) DO NOTHING` of the task
      row are unchanged; the kind only rides along in the insert values.

### Migration `e7f8a9b0c1d2` (after `d6e7f8a9b0c1`)

Adds the four columns, then backfills in the batched style of `d0e1f2a3b4c5`, with two changes: the database first
drops every row whose JSON does not even contain `cli` (`LIKE '%cli%'`), and the walk is keyset by id instead of
OFFSET. Telemetry `properties`, report `payload` and exchange `payload` are parsed with a frozen copy of the rule.
Tasks become `cli` when a telemetry event of the same user for that task is `cli`. The schema bootstrap is
create_all plus stamp (`src/db_bootstrap.py`), so the ORM declares the same columns.

### `/app/metrics`

- `compute_user_metrics(..., client=None)` adds `client_kind = :client` to the completion and embedding queries
  (SQL, not Python) and returns `by_client` (rows like `by_mode`, plus a `label`, "VS Code" / "CLI").
- The session-quality panel follows the same filter (`quality_overview(..., client)` on `tasks.client_kind`), so a
  CLI view does not grade VS Code runs.
- The page gets a second segmented control ("All clients", "VS Code", "CLI") next to the period selector and a "By
  client" breakdown table. The period links and the daily table pager keep `&client=`; the client links keep the
  current period. The client choice is not remembered; the period cookie works as before.

## Tests

- `tests/test_client_kind.py`: the rule (14 cases), `parse_client`, stamping of telemetry (explicit kind, editor
  name fallback, nothing), tasks (bridge then CLI event, CLI event before the row, never back, another user's events
  ignored, backfill properties incl. broken JSON and a re-share), error reports and LLM exchanges with and without
  the new fields (unknown value accepted), metrics filter and breakdown, quality panel filter, the page's links.
- `tests/test_migration_drift.py::test_client_kind_backfill_marks_the_clis_records_and_tasks`: seeds rows at
  `d6e7f8a9b0c1`, upgrades to head, checks every table's kinds. The drift tests stay green (ORM and migration agree).
- Updated pins, each only for the new output: `tests/fixtures/metrics_characterization.json` gains `by_client` in
  every period (the dataset has no CLI rows, so it is one `vscode` row equal to the totals, generated from the
  totals and then verified by the test); `test_metrics_read_only_the_columns_they_use` now expects `client_kind`
  among the selected columns; `tests/test_route_table.py` pins the new `client` query parameter of `/app/metrics`.

Verification: `cd self-hosted-cloudapi && uv run pytest -q` and `make lint`.

## Notes

- api image rebuild needed (columns, migration, metrics page). The migration runs on container start.
- Until the VSIX and the CLI with `clientKind` are rebuilt, the editor name fallback classifies everything: the
  current CLI already reports `wrapper|cli|...`.
- A tiny race remains on Postgres: when a task's very first bridge chunk and its very first CLI telemetry event
  commit at the same moment, neither sees the other. The next CLI event of the task (every completion sends one)
  marks the row, so it heals within one request.
