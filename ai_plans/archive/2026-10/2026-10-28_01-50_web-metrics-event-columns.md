# Web panel at scale, phase 1: the figures of an event in columns (2026-10-28)

**Status:** implemented on `feat/web-metrics-event-columns` (base `perf/web-scale-bench`, 455be9b99), local only.
**Related plans:** `2026-10-27_22-05_web-ui-db-query-scale.md` (the master plan, "Faza 1");
`2026-10-27_18-12_cloud-task-duration-request-time.md` (added `durationMs`, read here as a column).
**Touched:** `self-hosted-cloudapi/src/models/event.py`, `src/services/{telemetry_vocab,telemetry_service,metrics_service,model_attribution}.py`,
`src/services/problems/collect.py`, `src/web/presenters/metrics_view.py`, migration
`alembic/versions/e8f9a0b1c2d3_event_figure_columns.py`, tests.

## Problem

Every reader of an `LLM Completion` or `Embedding Usage` event fetched its whole JSON `properties` text and decoded it
in Python, because the figures lived nowhere else. On the bench corpus (4.9 M events, 432 k completions of the
power user, 3.73 M of the organization; `/tmp/web-scale-bench/base/summary.txt`):

| Page                                   | Median | SQL    | Python and rendering                   |
| -------------------------------------- | ------ | ------ | -------------------------------------- |
| `/app/metrics?period=all`              | 10.8 s | 2.6 s  | 8.2 s (432 k payloads, about 330 MB)   |
| `/app/metrics?period=all&space=org...` | 82.3 s | 17.9 s | 64.4 s (3.73 M payloads, 6.2 GB RSS)   |
| `/app/metrics?period=30d&space=org...` | 4.6 s  | 1.8 s  | 2.8 s                                  |
| `/app/diagnostics?period=all`          | 7.5 s  | 2.3 s  | 5.2 s (432 k payloads parsed to count) |

On the live deployment the same tables hold 34 092 completions and 19 270 embeddings (707 and 450 bytes per payload
on average).

## What was happening

- `metrics_service.compute_user_metrics` selected `TelemetryEvent.properties` (455be9b99, line 186) and
  `aggregate_user_metrics` decoded each row (`parse_event_props`, line 310) before reading tokens, cost, model,
  provider, mode, kind, `usageReported`, `durationMs` and `taskId` from the dict. `_embedding_payloads` (line 89) did
  the same for the embeddings.
- `problems/collect._request_counts` (line 402) fetched every completion payload of the period and decoded it in a
  worker thread only to count `(provider, model)`.
- `model_attribution.completions_for_task` (line 94) and `problems/collect._completions_by_task` (line 188) decoded
  the payloads of a task's completions.
- Each of these readers had its own fallback for a missing value: "unknown" on the metrics page, `UNKNOWN_MODEL`/`""`
  in diagnostics, no attribution on the task page.

## Fix

**One extraction rule.** `telemetry_vocab.event_columns(event_type, props)` returns the columns of an event:

- `LLM Completion`: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `duration_ms`
  (`int(figure(...))`), `cost` (`float(figure(...))`), `model_id`, `provider`, `mode` (`clean_name`, NULL when
  missing or empty), `completion_kind` (`completion_kind(props)`, owner decision 25) and `usage_reported` (False only
  when the client said `false`);
- `Embedding Usage`: `input_tokens` (its `promptTokens`) and `embedding_source`;
- any other event: nothing, its columns stay NULL.

**Bounds at the trust boundary.** The client chooses every value here: its own OpenAI-compatible server reports any
usage, custom model info sets any price, and a hand-made request sends anything. So the rule bounds each value
before it reaches a column that other users' pages sum:

- `utils/format.figure(value, limit)` is `num(value)` when it lies in `0..limit`, else 0, like a non-finite number.
  The limits of one request are `MAX_REQUEST_TOKENS` 10^9, `MAX_REQUEST_COST` $10,000 and `MAX_REQUEST_MS` 24 h,
  more than 1000 times the live maxima (790,622 input tokens, $0.36, 224 s). With them a token column summed over
  4.6 billion requests still fits a BIGINT, a cost sum stays finite, and no negative figure can cancel other
  members' usage on an organization's page.
- `telemetry_vocab.clean_name(value)` is the one rule for a name (model, provider, mode, kind, embedding source):
  only a string is a name; control, format and surrogate characters are removed (a NUL or a lone surrogate is text
  Postgres refuses, a bidi override would reorder a page); the rest is cut to `NAME_MAX_BYTES` (256 UTF-8 bytes) on
  a character boundary and trimmed; an empty result is NULL. The longest live model id has 41 characters, a Bedrock
  ARN about 90, so every real id passes unchanged.

Without them, one organization member could make every grouping of the admin's metrics page answer 500 for good
(two events of 5e18 tokens overflow the BIGINT sum, two costs of 1.5e308 the float8 sum, a cost of 1e300 the cost
formatting) or drive the organization's totals negative.

**Ingest.** `telemetry_service.event_row` builds the row `record_event` stores: the payload, `task_id`,
`client_kind` and `event_columns`. `note_completion_model` now takes the model from the row.

**Readers.** The metrics page selects the columns (the Python loop stays in this phase and only sums them; the
`metrics_view.GROUPINGS` callbacks take the row); the embedding totals read `(input_tokens, embedding_source)`;
`_request_counts` is a `GROUP BY provider, model_id` with `count(*)`, mapping NULL to `""` and `UNKNOWN_MODEL` as
before; `model_attribution.completions_by_task` is the one query for a task's completions (`model_id IS NOT NULL`
replaces the "names no model" check) and serves both the task page and diagnostics. `iter_event_props` and
`completion_from_properties` had no callers left and are gone.

Other readers of `properties` stay: the error events of diagnostics (`telemetry_occurrence`, at most the period's
error events), `projects.py` (the `repositoryUrl` of a task's events, at ingest time) and retention (size of
purgeable events; completions and embeddings are never purged).

**Migration `e8f9a0b1c2d3`** (after `d4e5f6a7b8c1`) adds the twelve nullable columns and fills them on every stored
completion and embedding, in batches of 5 000 by id (keyset), with a frozen copy of `event_columns`, `figure` and
`clean_name`. It decodes in Python, so a payload with `NaN` (which `json.dumps` writes and `jsonb` refuses) reads
like ingest reads it; a payload that is not a JSON object reads as an empty one, so no reader meets a NULL figure on
these two event types. The stored payloads are what clients sent before the bounds existed, so the frozen rule is
what lets the backfill finish: without it one stored figure of 2^63 or more, one non-string name or one NUL aborts
the whole upgrade (asyncpg refuses the row, the transaction rolls back, `db-migrate.sh` runs under `set -e` and the
API never starts). A payload longer than 16 384 characters reads as empty: real ones are under 1 KB, and the cap
bounds a batch to 5 000 times that in memory.

## Same numbers

- Every live payload of the two types is a JSON object (all 53 362 cast to `json`), every token count and duration
  an integer-valued number, every name a string, `usageReported` a boolean on all 34 092 completions, and the stored
  `task_id` column equals `properties.taskId` on all of them (read-only SELECTs). So storing whole numbers and
  reading `task_id` from its column reproduce today's figures.
- `tests/test_metrics_characterization.py` pins the whole metrics result for every period; its golden file is
  unchanged.
- On the migrated bench copy, the base code (decoding `properties`) and this branch (reading the columns) gave
  byte-identical results (`/tmp/f1-scratch/compare.py`, 13.7 MB of JSON each): the power user's all-time metrics
  grouped by project and by model, narrowed to the CLI and to one model over 30 days; the organization's 90 days by
  user and by model (465 630 completions); the request counts per provider and model, of both clients and of the
  CLI; all 23 841 occurrences of the problem report; the completions of 300 tasks. The all-time cost sum of
  432 136 completions matched to the last bit.

## Tests

- New: ingest stamps the columns (`test_telemetry_vocab.test_ingest_stores_the_figures_of_an_event`, through
  `record_event`: a full completion, one with only a task, strings, booleans, a float duration, empty names,
  `usageReported: false`, figures past the bounds and on them, a negative cost, names with a NUL, a zero-width space,
  a lone surrogate, a name that is a number, a list or an object, a name cut at 256 bytes inside a 4-byte character,
  three embeddings, another event type); the migration fills what ingest would store on tricky payloads, including
  `NaN`/`Infinity`/`1e999`, `{}`, NULL, non-JSON, a JSON list, a numeric kind, an event of another type, the hostile
  payloads a client could store before the bounds (10^19 tokens, a cost of 1e300, a NUL and a lone surrogate in
  names, non-string names) and an oversized payload, across a batch boundary
  (`test_migration_drift.test_event_figure_backfill_stores_what_ingest_stores`);
  `_request_counts` semantics (`test_web_diagnostics.test_request_counts_are_the_periods_completions_by_provider_and_model`).
- Seeding: every bare `TelemetryEvent(...)` in the tests goes through `tests/web_helpers._event_row`, which calls
  `event_row`, so a test row is what ingest stores.
- Changed assertions, with the reason: `test_metrics_read_only_the_columns_they_use` now lists the columns (what
  this phase changes); `test_format_helpers_are_single_source_of_truth` pins `num` in `telemetry_vocab` instead of
  `metrics_service`; the single-source test drops the payload helpers the readers no longer import.
- Removed, with the reason: the tests that a reader skips a payload that is not a JSON object
  (`test_metrics_and_attribution_skip_payloads_that_are_not_json_objects`,
  `test_only_malformed_rows_count_nothing_but_still_have_data`, and the malformed rows of the characterization
  dataset, which contributed nothing to its golden figures). No reader decodes a payload any more, ingest always
  stores an object, and what the migration does with such a payload is covered by the backfill test.
  `test_completion_kind` and `test_completion_kind_on_the_task_detail_page` became one test through
  `event_columns`, since both pages now read the same column.
- Mutations, each turned a test red and was restored: `provider or ""` changed to `"unknown"` and the client filter
  dropped in `_request_counts`; `usage_reported` true only for an explicit `true`; an empty model name stored as
  `""`; `event_row` not stamping the columns; the frozen `_num` keeping non-finite floats; the backfill stopping
  after one batch; the frozen kind rule without its type check; the `model_id IS NOT NULL` filter dropped (survived
  at first, so the attribution test now seeds a completion without a model); the metrics "unknown" fallbacks for
  model and embedding source; the bounds dropped from `figure` (the out-of-bounds cases red); `clean_name` returning
  any value as is (the odd-name, long-name and non-string kind cases red); in the migration, the frozen bound
  dropped (SQLite refuses the 10^19 integer), the frozen name rule dropped (the surrogate cannot be encoded) and the
  payload cap dropped (the oversized payload's figures differ).

## Measurements

Full run (`WEB_BENCH_LABEL=f1`, `/tmp/web-scale-bench/f1/summary.txt`) against the baseline
(`/tmp/web-scale-bench/base/summary.txt`), median of 5 runs, milliseconds, SQL / everything else:

| Page                    | Base                     | This branch              |
| ----------------------- | ------------------------ | ------------------------ |
| `metrics_all`           | 10 757 (2 559 / 8 199)   | 9 252 (5 079 / 4 173)    |
| `metrics_30d`           | 412 (120 / 292)          | 307 (157 / 150)          |
| `metrics_org_all_user`  | 82 270 (17 884 / 64 386) | 51 406 (17 863 / 33 544) |
| `metrics_org_all_model` | 80 192 (18 003 / 62 189) | 47 815 (16 650 / 31 165) |
| `metrics_org_30d`       | 4 603 (1 756 / 2 848)    | 2 970 (1 590 / 1 380)    |
| `diagnostics_all`       | 7 464 (2 257 / 5 206)    | 3 156 (2 199 / 957)      |

The list pages are not touched by this phase; they came out 10 to 20 % faster, inside the noise of the bench.

Back to back, the four telemetry pages only (`/tmp/f1-bench/measure_subset.py`): a fresh copy of `web_base` with
the base code, then this branch on its migrated copy, then the same copy after `VACUUM FULL`:

| Page              | Base, fresh copy       | Branch, migrated      | Branch, compacted     |
| ----------------- | ---------------------- | --------------------- | --------------------- |
| `metrics_all`     | 13 669 (6 312 / 7 356) | 7 194 (2 961 / 4 233) | 7 498 (3 106 / 4 391) |
| `metrics_30d`     | 390 (103 / 287)        | 302 (156 / 146)       | 325 (162 / 164)       |
| `metrics_org_30d` | 4 865 (2 649 / 2 216)  | 2 931 (1 570 / 1 362) | 4 234 (2 705 / 1 530) |
| `diagnostics_all` | 6 182 (1 821 / 4 361)  | 3 471 (2 306 / 1 165) | 3 072 (2 127 / 945)   |

What the numbers say:

- The time outside SQL, which was mostly decoding JSON, roughly halves on the metrics pages and drops by 75 to 80 %
  on the problem report. That part is stable from run to run.
- The SQL time moves between runs by up to 2x with the page cache (the fresh base copy's `metrics_all` statement took
  6.3 s here against 2.6 s in the original base run), so the SQL columns above are not a result of this branch. The
  statements still scan the same rows: the completions statement now carries about 140 bytes of the event per row
  instead of about 770, so its sort spills 82 MB instead of 336 MB, but the plan is the same shape (bitmap or
  sequential scan of the table, sort by `created_at`).
- JIT still fires: 443 ms of the 822 ms `GROUP BY` of the problem report, 1.4 s of the organization's completions
  statement.
- The organization's all-time page stays unusable at 48 to 51 s: the Python loop still visits 3.73 M rows (33 s), and
  the statement still transfers them (17 s). Phase 2 (sums in SQL) is what makes it interactive.

Migration on the bench copy: `alembic upgrade head` took 858 s for 4 873 725 completion and embedding rows (about
5 700 rows per second, the Postgres backend at 80 % of a core, the alembic process at 105 MB). The table grew from
5.1 GB to 10 GB with indexes, because every updated row leaves a dead version; the following `VACUUM ANALYZE` took
177 s (2.4 s on base) and makes that space reusable without shrinking the file (`VACUUM FULL` brought it back to
5.4 GB in 78 s). On the live deployment the migration touches 53 362 of 267 267 rows (34 092 completions, 19 270
embeddings): at the bench rate about 10 s, and about 20 % growth of the table. That is an estimate, not a
measurement.

## Caveats

- Behaviour changes only where a real client never sends the input, each checked against the live data and the
  extension: a stored payload that is not a JSON object now counts as an empty completion (readers skipped it; ingest
  always stores an object and no live row is one); a completion with an empty payload `{}` now counts in the problem
  report's request counts under `("", UNKNOWN_MODEL)` (it was skipped there, while the metrics page counted it); a
  fractional token count or duration is stored whole (the extension sends integers, `durationMs` is `Math.round`ed);
  a figure outside the bounds of one request counts as 0, and a name is cleaned (no live completion is outside the
  bounds, and every live name is a clean string under 256 bytes). Such an event keeps its raw `properties`, so the
  figures it claimed stay on record.
- The migration runs while the API is down (`db-migrate.sh` before the server starts). At the bench's 4.9 M rows that
  is 14 minutes, and a deployment with tens of millions of events would wait hours. The live one needs seconds, so
  the backfill stays the plain keyset loop of the precedent; dropping the secondary indexes of `telemetry_events`
  during the backfill (each non-HOT update inserts into all seven) or one set-based UPDATE per batch are the options
  if a large deployment ever needs it.
- `scripts/web_scale_seed.py` builds `web_base` with `create_all` and stamps the alembic head. Run from this branch
  it would create the new columns and stamp `e8f9a0b1c2d3` without filling them; build the template from the base
  commit, as the bench recipe says.
- The test helper `tests/web_helpers._event_row` is the only way tests should seed telemetry: a bare
  `TelemetryEvent(...)` leaves the figure columns NULL, and the metrics loop fails on them.
