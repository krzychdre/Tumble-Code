# Web panel at scale: the metrics page sums a rollup per task and quarter of an hour (2026-10-28)

**Status:** implemented on `feat/web-metrics-rollup` (base `perf/cloud-db-session-settings`, which sits on
`fix/cloud-hostile-client-bounds` and `feat/web-pg-indexes`), local only. Migration `f2b3c4d5e6a7` revises
`f1b2c3d4e5a6`.
**Related plans:** `2026-10-27_22-05_web-ui-db-query-scale.md` (the master plan, open decision 6: the organization's
metrics in constant time); `2026-10-28_03-35_web-metrics-sql-rollup.md` (phase 2, whose "metrics_daily" section
counted the grain built here); `2026-10-28_01-50_web-metrics-event-columns.md` (phase 1, the columns summed here).
**Touched:** `self-hosted-cloudapi/src/models/{event,__init__}.py`, `src/services/{telemetry_service,metrics_service}.py`,
`src/services/problems/collect.py`, `src/web/presenters/metrics_view.py`, migration
`alembic/versions/f2b3c4d5e6a7_usage_rollup.py`, tests (`web_helpers.py`, new `test_usage_rollup.py`, the metrics,
diagnostics and migration tests).

## Problem (measured)

After phases 1 to 4 every statement of the metrics page still read every `LLM Completion` event of its period. On the
bench corpus (4.40 M completions; the power user has 432 k, the organization `org_bench` 3.73 M), the stack top's code
(phase 4 as it was then, 01efabe41; "stack top" below means that code) on a copy migrated through this branch, median of 5 runs, ms (SQL / everything else):

| Page                    | Stack top             |
| ----------------------- | --------------------- |
| `metrics_all`           | 4 274 (4 137 / 137)   |
| `metrics_org_all_user`  | 16 295 (15 604 / 691) |
| `metrics_org_all_model` | 21 817 (21 137 / 680) |
| `metrics_org_30d`       | 3 340 (3 303 / 37)    |
| `diagnostics_all`       | 3 102 (2 205 / 896)   |

`LLM Completion` and `Embedding Usage` events are never swept (`retention_service.PROTECTED_EVENT_TYPES`), so these
times grow with the history for as long as the deployment runs.

## What was happening

- Each of the three to five statements of `metrics_service.compute_user_metrics` (01efabe41, `_completions`, lines
  138-191) scanned the period's completions again: in the organization a parallel scan of 3.73 M rows hash-joined to
  its 170 k tasks, then a sort on disk for the GROUP BY (the two-column owner join was estimated at 21 k rows).
- `problems/collect._request_counts` (line 389) grouped the reader's completions of the period by provider and model:
  760 ms of the diagnostics page.

## Fix

**A table of sums, `usage_rollup`** (`models/event.UsageRollup`). One row per user, event type, quarter of an hour of
UTC, task and combination of names (model, provider, mode, completion kind, indexing source, client), holding the sums
of the events' figure columns of the same names (tokens, cache tokens, cost, request duration), how many events it
sums (`events`), how many of them are completions whose usage was not reported (`unreported`) and the earliest
`created_at` (`first_at`, for the order of rows that tie). The quarter is `quarter_of(created_at)`, the bucket phase 2
already folded into the reader's local days. On the bench: 367 364 completion rows for 4.40 M completions (the count
phase 2 predicted for this grain) and 127 721 embedding rows for 474 k embeddings, 217 MB with its key.

The grain answers everything the page shows: a reader's local days (whole quarters), distinct task counts and the
project grouping (`task_id` is kept, the task and its project are joined at read time, so a task that moves to
another project moves with them). Embeddings live in the same table, by source, with the figures they do not have
at zero: the indexing figure reads the reader's own rows like the completions do.

**The key.** The primary key is `(user_id, event_type, quarter, names_key)`, `names_key` being the sha256 of the task
id, the names and the client (`telemetry_service.rollup_key`). The client chooses the task id and the names and can
make them as long as a Postgres btree entry allows on their own (2 704 bytes), so a key made of the columns
themselves could not be stored for such an event. The hash also keeps missing names unique on both databases (a JSON
`null`, where a unique index would treat NULLs as distinct). The key's order serves the reads: one user's rows of one
type over a range of quarters.

**Ingest.** `record_event` ends with `add_to_rollup`: one `INSERT ... ON CONFLICT DO UPDATE` (`database.dialect_insert`)
that adds the event's figures to its row's sums and keeps the earlier `first_at`. Two transactions adding into one row
both count: the second waits for the first's row lock and adds to what it committed. The statement runs last so the
row stays locked for the shortest time; only events of the same user, task, names and quarter ever wait for each
other. A row of a past quarter never changes again.

**Readers.** `compute_user_metrics` keeps phase 2's statements and reads `usage_rollup` instead of the events:
`count(*)` became `sum(events)`, the unreported FILTER `sum(unreported)`, `min(created_at)` `min(first_at)`, the
quarter is the column, and the period starts at `quarter >= quarter_of(start)`: a period starts at a local midnight,
which starts a quarter. Whole sums come back as Python ints from Postgres' NUMERIC (`_Total`), and a group's tokens
are `sum(input_tokens) + sum(output_tokens)` instead of the sum of each row's two (see "Hostile clients").
`metrics_view.GROUPINGS` keys the model and user groups on the rollup's columns. In the organization the owner check
joins `tasks.user_id = usage_rollup.user_id`: phase 2 wrote it as `IS NOT DISTINCT FROM`
to keep Postgres from probing the event indexes once per task, but the rollup has no task index to probe, and both
forms took the same time on every organization statement measured (all time, 30 days, narrowed to a project).
`_request_counts` sums `events` per provider and model from the rollup.

**Migration `f2b3c4d5e6a7`.** Creates the table and builds the rows of the stored events from phase 1's columns: one
`SELECT ... GROUP BY` (the quarter computed in SQL as phase 2 did), streamed through Python in batches of 5 000 groups
for the key (no hash function exists on both databases), each batch one insert. Events of a deleted user (`user_id`
NULL, which no page reads) and events without a `created_at` (no quarter; only a raw insert writes one) stay out. On
the bench: 57.7 s for 4.9 M events, 96 MB of peak memory.

**Deleting a user.** `usage_rollup.user_id` is `ON DELETE CASCADE`: the deleted user's rows go with them, so no
unique conflict can arise, and the pages read what they read before, since the events keep a NULL user that no page
counts (the reader's own page needs their id, the organization's the task owner's).

## Hostile clients

What a client controls reaches this table through phase 1's columns, which ingest and phase 1's backfill bound per
value (`utils/format.figure`: each token count at most 10^9, `duration_ms` at most 24 h, each cost in 0..10,000, 0
outside; each name cleaned and cut to 256 bytes), for stored and new events alike. The arguments below need each
token count and duration at most 10^10 and each cost finite and at most 10^15 in absolute value, which those bounds
satisfy with room to spare.

- **One row fed by a flood.** Every increment of a row is a transaction that holds the row's lock until it commits.
  Measured on the bench machine (`/tmp/f5-scratch/hot_row.py`, 32 connections doing nothing but the increment): 458
  commits a second on one row, 4 140 with synchronous commit off. A quarter of an hour then takes under 10^7
  increments, at most 10^17 per BIGINT sum (its limit is 9.2 * 10^18), and costs stay far from the float range.
- **The organization's page.** Its sums cover every member's rows and grow without a bound with the history. Whole
  sums are read as Postgres NUMERIC and converted in Python (`metrics_service._Total`), where phase 2's cast back to
  BIGINT would fail the page once an organization's tokens passed 9.2 * 10^18; a row's input and output are summed
  apart before they are added, so the page reads any value a BIGINT column holds without failing. Float costs stay
  far from overflow under the bound above.
- **Another user's task id.** A row belongs to the event's user. The reader's own page joins only the reader's tasks;
  the organization's counts a row only on its owner's task. Unchanged from phase 2, covered by its tests and by the
  randomized test (an outsider's events naming the organization's tasks).
- **Long ids, many models.** A fixed-size key; a flood of distinct names makes the attacker's rows as many as their
  events, which costs the organization's page what phase 2 cost it.
- **The migration.** It completes on any stored events: a group is one user's events of one quarter of an hour, so
  its sums stay within BIGINT under the bound; NULL users and times are left out, names of any length go into the
  hash, and memory is bounded by the batch.

## Same numbers

- On the bench, the stack top's code and this branch's on the same copy (`/tmp/f5-scratch/equivalence.py`,
  `compare.py`): 18 calls of `compute_user_metrics` and 3 of `_request_counts`, every figure, name and order identical,
  5 449 floats different in the last bits (at most 3.1e-14 relative). Two runs of the stack top's own code differ the
  same way (4 566 floats, at most 1.3e-14): Postgres adds a parallel aggregate's parts in any order. The calls: the
  power user's all time by project in UTC and by model in Europe/Warsaw, the CLI only in Asia/Kathmandu, narrowed to
  "No project" and to the top project; 30 days in America/St_Johns narrowed to the top model, 90 days of VS Code
  narrowed to "No model", 7 days ungrouped in Asia/Kolkata, today in Europe/Warsaw; the organization's all time by
  model, by user, narrowed to the top model, to "No project" and (VS Code, Asia/Kathmandu) to the top project, 90 days
  by user and narrowed to the top user, 30 days by project, 7 days of the CLI in Asia/Kathmandu; request counts for
  all time, 30 days of the CLI and 7 days.
- The golden file of `test_metrics_characterization.py` is unchanged.

## Tests

- New, `test_usage_rollup.py`:
    - `test_the_rollup_reads_like_the_events_it_sums` (SQLite, and Postgres with `RECALL_PG_URL`): 400 random events
      through `record_event` (three users, an organization, visible and hidden projects, other users' and unknown task
      ids, missing and odd names, both clients, unreported usage, embeddings, instants on quarter boundaries and local
      midnights), then the rollup's rows and every page (both spaces, every grouping, unnarrowed and narrowed to each
      group and to "no key", five periods in four zones, request counts) compared with the same after replacing the
      rollup by one row per event with the quarter computed in SQL: the events as phase 2 summed them.
    - `test_concurrent_ingests_into_one_row_all_count` (Postgres): one transaction holds the row, first a new one,
      then an existing one, while nineteen more add an event into it; all forty count.
    - `test_names_of_any_length_fit_the_key` (Postgres): a 2 500-character task id and model id are stored and read.
    - `test_an_organizations_totals_hold_any_sum` (Postgres): two rows of 2^62 sum to 2^63 on the organization's page.
    - `test_deleting_a_user_deletes_their_rows_only`.
- New: `test_client_timezone.test_a_period_starts_exactly_at_the_local_midnight` (both databases, Asia/Kathmandu and
  America/St_Johns): a call at the first instant of the period counts, one a microsecond before it does not, in the
  totals, the indexing figure and the request counts.
- New: `test_migration_drift.test_usage_rollup_holds_the_stored_events_as_ingest_sums_them`: the migration's rows,
  keys included, for events in one quarter, the next one, another user, an embedding, a deleted user, no time and
  another type.
- Changed: `test_metrics_sum_in_sql_and_read_no_payload` became `test_metrics_sum_the_rollup_and_never_read_the_events`;
  the plan-cache test of `test_web_metrics_groups.py` looks for the rollup's statements. The tests that seed
  completions or embeddings for a page store them with `web_helpers._store`, which adds each event into the rollup as
  ingest does.
- Mutations, each turned a test red and was restored: the sums overwritten instead of added; read, then written (the
  concurrency test: 2 of 40 counted); the later `first_at` kept; the client left out of the key; `unreported` not
  counted; the quarter off by one; `>` for the period start in the page, the indexing figure and the request counts
  (only the new midnight test caught these three); the BIGINT cast of the sums back; `SET NULL` for the user's
  foreign key; the plain names as the key (Postgres refused the index entry); in the migration, deleted users kept,
  the key without the client, the unreported filter inverted.
- Full suite at the top of the stack (`feat/web-metrics-rollup`, on phases 1 to 4, the hostile-client bounds and the session settings), with the Postgres lane (`RECALL_PG_URL`): 1585 passed, 1 xfailed.

## Measurements

The official script on the same migrated copy, this branch then the stack top's code, back to back
(`/tmp/web-scale-bench/rollup/`, `/tmp/web-scale-bench/rollup_f4top/`), median of 5 runs, ms (SQL / everything else):

| Page                    | Base   | Stack top             | This branch         |
| ----------------------- | ------ | --------------------- | ------------------- |
| `metrics_all`           | 10 757 | 4 274 (4 137 / 137)   | 364 (212 / 152)     |
| `metrics_30d`           | 412    | 321 (304 / 16)        | 30 (15 / 16)        |
| `metrics_org_all_user`  | 82 270 | 16 295 (15 604 / 691) | 2 134 (1 445 / 689) |
| `metrics_org_all_model` | 80 192 | 21 817 (21 137 / 680) | 2 614 (1 877 / 737) |
| `metrics_org_30d`       | 4 603  | 3 340 (3 303 / 37)    | 209 (174 / 35)      |
| `diagnostics_all`       | 7 464  | 3 102 (2 205 / 896)   | 2 451 (1 551 / 900) |

The base column is `/tmp/web-scale-bench/base/summary.txt`, another copy. The task list's pages are within noise of
the stack top. The organization's all-time statements read its 311 388 rollup rows instead of its 3.73 M events,
300 to 660 ms each (EXPLAIN: no JIT; the two-column owner join is still underestimated, so the GROUP BY sorts on
disk), and the page narrowed to its largest project takes 0.5 s for all time and 0.2 s for 90 days (`compute_user_metrics`
alone). About 700 ms of each organization page is rendering. The diagnostics page's slowest statement is now
`model_attribution.completions_by_task`, outside this branch.

Ingest, 900 `LLM Completion` events each in its own transaction (`record_event` and the commit, as the API does), on
the same copy, two rounds: median 5.70 and 5.92 ms with the stack top's code, 6.01 and 6.40 ms with this branch (mean
5.75 and 6.48 against 6.71 and 7.46). The upsert call alone, Python building the statement and its round trip, took
1.6 to 1.9 ms median within the same runs; the machine was shared with other measurements, so the difference of the
end-to-end medians is the rougher figure.

## Caveats

- The bound on a stored figure is phase 1's rule, at ingest and in its backfill; this branch adds none of its own.
  Without it, a client could fill one row past a BIGINT, and two stored events of one row with more than 4.6 * 10^18
  tokens each would stop this migration.
- `plan_cache_mode` comes from the engine (`perf/cloud-db-session-settings`); the plan-cache test of the metrics page
  now looks for `FROM usage_rollup`.
- A user's all-time page reads the whole table in a parallel scan rather than their rows by the key (the power
  user's 36 750 of 495 085 rows), about 100 ms on the bench. It grows with the table, which grows about twelve times
  slower than the events.
