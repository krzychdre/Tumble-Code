# Postgres session settings for every app connection (2026-10-28)

**Status:** implemented on `perf/cloud-db-session-settings` (base `feat/web-pg-indexes`, phase 4), owner decisions 1
and 2 of the master plan.
**Related plans:** `2026-10-27_22-05_web-ui-db-query-scale.md` (master plan, "Otwarte decyzje właściciela" 1 and 2;
the bench is its `scripts/web_scale_seed.py` and `scripts/web_scale_measure.py`);
`2026-10-28_03-35_web-metrics-sql-rollup.md` (phase 2, which set `plan_cache_mode` per transaction in
`compute_user_metrics`); `2026-10-28_00-06_cloud-web-list-indexes.md` (phase 4, whose Caveats measured the list's
generic plans); `2026-10-26_18-22_cross-session-recall.md` (recall search's own per-transaction setting).
**Touched:** `self-hosted-cloudapi/src/database.py`, `src/services/metrics_service.py`, `src/services/recall_search.py`,
`tests/conftest.py`, `tests/test_health_shutdown.py`, `tests/test_recall_pg.py`, `scripts/recall_benchmark.py`.

## Problem, measured

The live server (PostgreSQL 16.15) and the bench run the defaults: `plan_cache_mode = auto`, `jit = on`,
`jit_above_cost = 100000`.

- **Generic plans.** SQLAlchemy's asyncpg dialect prepares every statement and keeps it per connection. Under `auto`,
  after five custom plans of a prepared statement Postgres compares a generic plan's estimated cost with the average
  of the custom ones and may keep the generic plan for every later run on that connection. The generic plan is
  estimated for an average user, so for a heavy one it reads far too much. Measured before this branch: the task
  list's project names 1.15 ms custom against 17.5 ms generic, the anchor of `descendant_ids` 1.1 ms against 94 to
  350 ms (phase 4), a narrowed metrics page minutes (phase 2). Phase 2 and the recall search fixed this only for
  their own statements, with `SET LOCAL plan_cache_mode = force_custom_plan`.
- **JIT.** The metrics aggregates exceed `jit_above_cost`, and compiling them cost about a second per statement more
  than it saved (the master plan's decision 1: the organization's 30-day page 3.3 s with JIT, 2.5 s without).

This branch found one more generic plan, on the write path: every final live message runs `refresh_task_summary`,
which calls `refresh_task_models`, whose read of the task's completions (`model_attribution.completions_by_task`,
`task_id IN (...) AND user_id = ? AND event_type = ? AND model_id IS NOT NULL ORDER BY created_at`) has these two
plans on the bench for the power user:

| Plan    | What it reads                                                                                                   |   ms |
| ------- | --------------------------------------------------------------------------------------------------------------- | ---: |
| custom  | index scan of `ix_telemetry_events_task_id`, 14 entries                                                         | 0.16 |
| generic | BitmapAnd of `ix_telemetry_events_task_id` and `ix_telemetry_events_user_id`: 695,348 entries (estimated 2,753) | 63.7 |

The generic plan's estimated cost (54) is lower than the custom one's (318), so Postgres keeps it.

## Fix

- `src/database.py`: `make_engine(url, **options)` builds every engine on the app's database. On Postgres it passes
  `connect_args={"server_settings": {"plan_cache_mode": "force_custom_plan", "jit": "off"}}`, so asyncpg sends both
  in the startup packet of every connection the pool opens; SQLite gets nothing. The app's engine is
  `make_engine(ASYNC_DATABASE_URL, **_engine_kwargs)`, with the pool settings as before.
- `metrics_service.compute_user_metrics` and `recall_search.search` lose their `SET LOCAL plan_cache_mode`. Recall
  keeps its `SET LOCAL statement_timeout` inside the savepoint.
- The Postgres test fixtures (`pg_session` in `conftest.py`, `pg_factory` in `test_recall_pg.py`, `factory` in
  `test_hostile_clients.py`) and
  `scripts/recall_benchmark.py` build their engines with `make_engine`, so the Postgres lane and the recall gate run
  under the app's settings. Without that the recall benchmark, which runs each search 40 times on one pooled
  engine, would time generic plans the app no longer uses.
- Not shared, measured: `alembic/env.py` keeps the server defaults. The event figures backfill (`e8f9a0b1c2d3`)
  walks the primary key in batches of 5,000: its custom and generic plans are the same primary key scan, estimated
  at 1,949 and 64,594, both under the JIT threshold, and each row's UPDATE is a primary key lookup. The run totals
  backfill (`f0a1b2c3d4e5`) is one recursive UPDATE over every task, and it ran faster with JIT on the bench: 14.4 s
  against 19.0 s (one run each, rolled back).
- Not changed: `scripts/web_scale_measure.py` (one-off). It times the app's engine, so its page timings carry the new
  settings, but its EXPLAIN files come from a raw asyncpg connection with the server defaults and still show JIT.

## Tests

- `test_health_shutdown.py::test_postgres_connections_plan_for_their_values_without_jit` (Postgres lane): a
  connection of an engine from `make_engine` reports `plan_cache_mode = force_custom_plan` and `jit = off`.
- `test_web_metrics_groups.py::test_postgres_plans_every_load_for_its_values` (phase 2) still holds: 7 loads of a
  narrowed organization page, 0 generic plans, now through the engine's setting instead of the `SET LOCAL`.
- Mutations, each reverted: `make_engine` without `connect_args` turned both tests red (`('auto', 'on')`, and 6
  generic plans in the metrics test); the settings without `jit` turned the new test red.
- Full suite at the top of the stack (`feat/web-metrics-rollup`, on phases 1 to 4, the hostile-client bounds and the session settings), with the Postgres lane (`RECALL_PG_URL`): 1585 passed, 1 xfailed. `ruff check` and `ruff format --check` clean.

## Measurements

One copy of the bench template migrated to the stack top (upgrade 790 s, VACUUM ANALYZE 123 s), measured with the
phase 4 code (before) and this branch (after) from their own worktrees. "Before 2" and "after" ran back to back
under one lock and are the comparison; "before 1" ran earlier and is slower than "before 2" on most pages.

**Steady state:** 10 requests in a row per page, each page on a fresh connection of the app's engine, two rounds per
code version. Median wall ms / median SQL ms of requests 1 to 5 and 6 to 10; generic plans counted over the
parameterized statements of the connection after the 10 requests:

| Page                                      |  Before 1-5 | Before 6-10 |   After 1-5 |  After 6-10 | Generic plans before / after |
| ----------------------------------------- | ----------: | ----------: | ----------: | ----------: | ---------------------------: |
| `/app`                                    |    141 / 49 |   378 / 287 |    135 / 49 |    134 / 49 |                       35 / 0 |
| (round 2)                                 |    137 / 48 |   374 / 290 |    141 / 52 |    133 / 47 |                       35 / 0 |
| `/app?group=none&model=GLM`               |     41 / 19 |     68 / 47 |     37 / 19 |     38 / 19 |                       30 / 0 |
| (round 2)                                 |     45 / 23 |     62 / 44 |     39 / 20 |     38 / 19 |                       30 / 0 |
| `/app/metrics?space=org_bench&period=30d` | 3546 / 3508 | 3435 / 3401 | 2692 / 2657 | 2593 / 2560 |                        5 / 0 |
| (round 2)                                 | 3424 / 3389 | 3375 / 3341 | 2640 / 2606 | 2604 / 2571 |                        5 / 0 |

The list pages now cost the same from the sixth request on as before it; the metrics page is 0.8 s faster on every
request (JIT; its own statements already had custom plans). The first request on a fresh connection is about 330 ms
for `/app` in both versions (statements prepared and catalogs read). Planning every execution cost nothing visible:
requests 1 to 5, which were custom plans before too, take the same time.

**The measure script** (`web_scale_measure.py`, median of 5 after a warm-up; all pages run one after another on one
pooled connection, so the statements the list pages share reach their sixth run early):

| Page (median ms)      | before 1 | before 2 | after | slowest statement before 2 / after |
| --------------------- | -------: | -------: | ----: | ---------------------------------: |
| metrics_all           |     6687 |     5623 |  3974 |                        2364 / 1639 |
| metrics_30d           |      423 |      394 |   339 |                          190 / 149 |
| metrics_org_all_user  |    21060 |    21829 | 20179 |                       10446 / 9847 |
| metrics_org_all_model |    26944 |    23597 | 27569 |                       9064 / 11061 |
| metrics_org_30d       |     4166 |     3441 |  3051 |                        1268 / 1079 |
| list_default          |      157 |      133 |   142 |                            25 / 28 |
| list_group_model      |      140 |      107 |   108 |                            18 / 19 |
| list_group_cost       |     1680 |     1462 |  1487 |                           142 / 59 |
| list_flat             |       51 |       42 |    29 |                           18 / 2.2 |
| list_flat_cost        |      698 |      580 |   629 |                            24 / 20 |
| list_flat_page_300    |       75 |       59 |    60 |                            19 / 29 |
| list_search           |       82 |       62 |    55 |                            21 / 24 |
| list_model_filter     |       68 |       50 |    41 |                            17 / 13 |
| diagnostics_all       |     4349 |     3318 |  2568 |                          813 / 867 |

The metrics pages run one statement fewer (the `SET LOCAL`). The all-time organization pages stay at 20 to 28 s
either way: they are external merge sorts on disk, where a second of JIT is inside the run-to-run spread. In "before
2" the slowest statement of `list_flat`, `list_group_model`, `list_flat_page_300` and `list_model_filter` was the
project names under a generic plan (17 to 19 ms); after, it is 2.2 ms on `list_flat`, and the other pages' slowest
statements are different ones. The cost-sorted lists are rendering-bound (over 85 % outside SQL).

**Write path:** the same branch code with the app's engine against a plain engine (server defaults), each on one
pooled connection; per round a fresh depth-3 subtask of the power user, 200 final messages
(`upsert_task_message`) then 200 LLM Completion events (`record_event`), each in its own transaction; rounds
alternating, two per engine:

| Write                | server defaults, median (p90) ms | app settings, median (p90) ms |
| -------------------- | -------------------------------: | ----------------------------: |
| final live message   |                      70.9 (78.8) |                   12.8 (17.6) |
| LLM Completion event |                       5.1 (10.2) |                     5.3 (7.2) |

Split over 30 final messages on one connection: server defaults 14.5 ms on messages 1 to 5, 70.6 ms from message
11; `force_custom_plan` alone 15.9 and 14.7 ms; `jit = off` alone 21.0 and 71.0 ms. The difference is the
completions read above (0.43 ms early, 57 ms late), so it is the generic plan, not JIT. An LLM Completion event
reads the task's completions only when a new model appears (`note_completion_model`), which is why events did not
change.

## Caveats

- Every execution is planned: about 1 to 2 ms per list page (phase 4's estimate), and requests 1 to 5 above, custom
  plans in both versions, take the same time. A prepared statement still skips parsing on later runs.
- One statement is slower under its custom plan: the runs page at a deep OFFSET (page 300), 28.5 ms against under
  18.6 ms with the generic plan it had before (phase 4 measured 25.8 to 36.7 ms custom against 16.8 ms generic).
  The page takes the same time (59 against 60 ms), since the project names on the same page got faster. Keyset
  pagination (master plan, phase 5) is the fix if deep pages matter.
- The settings are per connection and the server's defaults stay as they are: psql sessions, alembic and any other
  client of the database still get `auto` and JIT.
- The power user owns 10 % of the bench; for a user with a median history the generic plans above cost far less.
  The write-path figure grows with the user's number of completions (the `user_id` range the generic plan reads).

## Security

The settings are constants in `src/database.py`, sent when the pool opens a connection; nothing a client sends
reaches them, and no endpoint or input changes. They close a cost a signed-in client could impose on the shared
database: any client can send enough telemetry to give its account a large history, and a generic plan, estimated
for an average account, then read that history's whole index range. The per-transaction settings covered the
narrowed metrics page (minutes of one of the app's 30 pooled connections) and recall; they did not cover the live
message write (13 against 71 ms per final message) or the list. Now every statement is planned for the request's
own values. JIT off removes about a second of CPU per large metrics statement. Recall's `statement_timeout`, the
bound on a client-chosen search, is kept.

## Deploy

No migration. The api image picks the settings up on start; the pool's connections are new after a restart.
