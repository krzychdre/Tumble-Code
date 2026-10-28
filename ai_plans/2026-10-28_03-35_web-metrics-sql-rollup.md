# Web panel at scale, phase 2: the metrics page sums in SQL (2026-10-28)

**Status:** implemented on `feat/web-metrics-sql-rollup` (base `feat/web-metrics-event-columns`, 59df4dd78), local only.
**Related plans:** `2026-10-27_22-05_web-ui-db-query-scale.md` (the master plan, "Faza 2" points 1 and 2; point 3,
the `metrics_daily` table, measured and not built); `2026-10-28_01-50_web-metrics-event-columns.md` (phase 1, the
columns summed here).
**Touched:** `self-hosted-cloudapi/src/services/metrics_service.py`, `src/web/presenters/metrics_view.py`,
`src/routers/web_metrics.py`, `src/services/problems/service.py` (docstring), tests (`conftest.py`,
`test_client_timezone.py`, `test_web_metrics_groups.py`, `test_metrics_characterization.py` and its golden file,
`test_event_loop_offload.py`). No migration.

## Problem

After phase 1 the metrics page still fetched one row per completion of the period (16 narrow columns, `ORDER BY
created_at`) and summed them in a Python loop. On the bench corpus (4.9 M events; the power user has 432 k
completions, the organization `org_bench` 3.73 M; `/tmp/web-scale-bench/f1/summary.txt`), median of 5 runs, SQL /
everything else:

| Page                    | Base                     | Phase 1                  |
| ----------------------- | ------------------------ | ------------------------ |
| `metrics_all`           | 10 757 (2 559 / 8 199)   | 9 252 (5 079 / 4 173)    |
| `metrics_org_all_user`  | 82 270 (17 884 / 64 386) | 51 406 (17 863 / 33 544) |
| `metrics_org_all_model` | 80 192 (18 003 / 62 189) | 47 815 (16 650 / 31 165) |

The organization's all-time page spent 33 s in the loop over 3.73 M rows and 17 s fetching them.

## What was happening

- `metrics_service.compute_user_metrics` (59df4dd78, lines 182-244) selected every completion of the period with its
  task's project and, in an organization, its owner's name, ordered by `created_at`.
- `aggregate_user_metrics` (line 267, run in a worker thread from line 255) looped over the rows: totals, five
  breakdowns, the reader's local day of each event, a set of task ids, and the group of each event through a
  Python callback (`metrics_view.Grouping.event_key`, line 43; `_event_user`, line 48).
- `only` (the page narrowed to one group) was applied in that loop, after every row of the period had been fetched.

## Fix

**Five aggregate statements, no event row in Python.** `compute_user_metrics` builds the period's completions once
(`_completions`: the reader's, or the organization's tasks by their owner, with the task, project and owner joined)
and adds a different GROUP BY to it each time:

1. per combination of `(model_id, mode, provider, completion_kind, client_kind)`: the token, cost and duration
   sums, the count and the unreported count (`count(*) FILTER (WHERE usage_reported IS false)`). Python adds these
   rows (215 for the power user, 304 for the organization) into the totals and the five breakdowns;
2. `count(DISTINCT task_id)`: `task_count`. Grouped by project or by user, a task is in exactly one group (the key
   is its project, or its owner after the owner check), so `task_count` is the sum of the groups' tasks and this
   statement does not run (`GroupBy.per_task`); grouped by model, a task can be in several groups;
3. per quarter of an hour of UTC (`_by_day`): tokens and cost, which Python adds into the reader's calendar days;
4. per group (`_groups`, only when grouped): key, name, tokens, cost, count and `count(DISTINCT task_id)`;
5. per indexing source (`_embeddings`, the reader's own unnarrowed page only).

`aggregate_user_metrics`, its worker-thread offload, `_embedding_rows` and the `GroupKey` callbacks are gone; the
problem report's docstring no longer names the metrics page as running in a worker thread.

**Local days stay exact.** Every zone's offset from UTC is a whole number of quarters of an hour (`+05:45` in
Nepal, `+12:45` on the Chatham Islands), so a UTC quarter never straddles a reader's midnight, and the day of a
quarter is the day of its first instant (`local_day`, utils/clientzone, which handles DST). The quarter is
`CAST(floor(EXTRACT(epoch FROM created_at)) AS BIGINT) / 900`: SQLAlchemy compiles `extract("epoch", ...)` to
`EXTRACT` on Postgres and `STRFTIME('%s', ...)` on SQLite, and the `floor` matters on Postgres, where a cast to
BIGINT rounds (an event at 23:59:59.7 would land in the next day). The rows are bounded by the period: 96 a day at
most (18 031 for the power user's two years, 64 002 for the organization).

**Group keys in SQL.** `metrics_view.Grouping` holds SQL instead of callbacks: `key` (NULL for an event without
one) and `name` over the completions query's tables; `Grouping.events` coalesces them into `NO_KEY` and the
group's `empty` name. The user's name is `coalesce(nullif(trim(first || ' ' || last), ''), email)`, as
`_event_user` did. `MetricsView.events_condition()` narrows the page on the raw key column (`IS NULL` for
`NO_KEY`), like `tasks_condition()` does for the quality panel, and the router passes it as `narrow`, the way
`quality_overview` takes its condition. On the raw column the planner can use `ix_telemetry_events_user_type_created`
for a user: the organization's 90 days narrowed to one user went from 4.2 s (narrowed on the coalesced key) to
0.9 s.

**The organization's owner check.** The organization's events are joined to their task on `tasks.id = task_id AND
tasks.user_id IS NOT DISTINCT FROM telemetry_events.user_id`. With `=` (as in phase 1) Postgres estimated the
two-column join at 21 k rows against 1.24 M, and on a page narrowed to one project it chose a nested loop that ANDed
`ix_telemetry_events_task_id` with `ix_telemetry_events_user_id` once per task, reading 27 k index entries of the
power user for each of 20 403 tasks: 18.3 s for the distinct task count alone. `IS NOT DISTINCT FROM` is the same
test here (a task always has an owner), but the planner does not take it for an equality, so it builds no index
probe on it, and the same statement becomes a parallel hash join of 1.5 s. Phase 1 never met this plan because it
narrowed in Python, after a full scan.

For the same reason the owner's name comes from `users` joined on the event's `user_id`, not the task's: the rows
are the same (the owner check makes the two ids equal, and `tasks.user_id` is NOT NULL), but joined on the task the
event's user is tied to nothing, and every statement of a short period reads all of
`ix_telemetry_events_user_type_created` without its leading column (84,707 index pages for 7 days). Joined on the
event, Postgres walks the members and probes the index once for each.

**Custom plans.** On Postgres `compute_user_metrics` first runs `SET LOCAL plan_cache_mode = force_custom_plan`, as
`recall_search` does. asyncpg prepares every statement, and after five executions on a pooled connection Postgres
may keep a generic plan, built without the parameter values. The text of a narrowed statement is the same for every
user, project and bounded period, and its generic plan, estimated at one row, walks the project's tasks and, for
each, ANDs the task index with the user index, so it reads a heavy user's events once per task: the power user's
30-day page narrowed to a project took 0.5 s five times on one connection, then 47 s (11 to 12 s a statement), and
the all-time one minutes. Planning each statement for its values costs a few milliseconds.

**Order of rows that tie.** Unchanged where it was defined: a breakdown's names, the groups and the indexing
sources that tie on tokens (or on cost and tokens) keep the order of their first event, because each statement
orders its rows by `min(created_at)` before Python's stable sort, which is the insertion order the old loop had over
rows ordered by `created_at`. New: on an exact tie of the first timestamp the rows follow the names (or the key), and
indexing sources tie by first use where they used to follow the table's physical order.

## Same numbers

- Floats are summed in SQL, so a cost can differ in its last bits from the old left-to-right sum. In the golden file
  of `test_metrics_characterization.py` exactly two values changed: the all-time cost total and the `vscode` row,
  from `5.704999999999999` to `5.705`, which is the double nearest to the exact sum of the inputs. Displayed costs
  have four decimals.
- On the bench, phase 1 and this branch on the same copy migrated through phase 4 (`/tmp/f2-scratch/equivalence.py`,
  `/tmp/web-scale-bench/review/f2_cmp.py`): 12 calls, every figure, name and order identical, 5 285 floats different
  in the last bits (none by more than 1e-9 relative, no cost at four decimals). The calls: the power user's all time
  grouped by project in UTC and by model in Europe/Warsaw, the CLI only in Asia/Kathmandu, 30 days in
  America/St_Johns narrowed to the top model, 7 days ungrouped in Asia/Kolkata, all time narrowed to "No project" and
  to the top project; the organization's 90 days by user and narrowed to the top user, all time by model and narrowed
  to the top model, all time by project for VS Code in Asia/Kathmandu narrowed to the top project.

## Tests

- New: `test_client_timezone.test_daily_buckets_end_exactly_at_local_midnight`: calls a microsecond before and at
  both midnights of a day in Asia/Kathmandu (+05:45) and on the 25-hour and 23-hour days of Europe/Warsaw, on SQLite
  and on Postgres. `test_web_metrics_groups.test_postgres_sums_every_group_like_sqlite`: every grouping of both
  spaces, unnarrowed and narrowed to each group, gives the same page on Postgres as on SQLite (floats rounded to 9
  places). The Postgres cases run when `RECALL_PG_URL` is set, as in the CI job (new `pg_session` fixture in
  `tests/conftest.py`). `test_postgres_plans_every_load_for_its_values`: seven loads of a narrowed organization
  page on one Postgres connection leave no statement on the events with a generic plan.
  `test_a_task_in_two_groups_is_one_task_of_the_page`: in every grouping of both spaces, with tasks that used two
  models, the page counts as many tasks as the ungrouped page. Also: rows that tie keep their first-use order (groups
  and "By model"), and a group counts each task once.
- Changed: `test_metrics_read_only_the_columns_they_use` became `test_metrics_sum_in_sql_and_read_no_payload`
  (every statement on the events is a GROUP BY or the distinct task count, and none reads `properties`; four
  statements ungrouped and by project, five by model): the read shape is what this phase changes. The golden file
  changed in the two costs above. `test_web_metrics_groups` seeds through two functions (`_seed`,
  `_seed_organization`) so the Postgres test can reuse them, with fixed timestamps instead of the clock; its
  `_metrics` helper narrows through `MetricsView.events_condition()`.
- Removed: `test_event_loop_offload.test_metrics_aggregation_runs_off_the_loop`. It checked that the per-event loop
  ran in a worker thread; the loop is gone and what Python adds now is a few hundred rows.
- Mutations, each turned a test red and was restored: quarters of an hour made hours (Kathmandu, both databases);
  the `floor` dropped (Postgres only, all three days); the unreported FILTER dropped; `count(task_id)` instead of
  `count(DISTINCT task_id)` for the page and for a group (the group one survived at first, hence the "counts each task
  once" test); the narrowing dropped; `NO_KEY` not coalesced; the e-mail fallback of a user's name dropped; a hidden
  project named by `Project.name` alone; the `visible_to` condition dropped; the owner check dropped from either join;
  the "unknown" indexing source; the reader's zone ignored in `_by_day`; the duration not added; the first-use order
  dropped from the breakdown and from the groups statement; the `BIGINT` cast of a sum (Postgres returns NUMERIC);
  `IS DISTINCT FROM` instead of `IS NOT DISTINCT FROM`; `NO_KEY` narrowing as `= '(none)'`; no `plan_cache_mode`
  (Postgres); `per_task` false for projects or true for models; `task_count` as the number of groups; users joined on
  the event's task id. Survived, as it should: grouping by the expressions instead of their labels (both are valid
  SQL on both databases). Survived, and no test counts an organization's statements: `per_task` false for users,
  which only adds the count statement back.
- Full suite at the top of the stack (`feat/web-metrics-rollup`, on phases 1 to 4, the hostile-client bounds and the session settings), with the Postgres lane (`RECALL_PG_URL`): 1585 passed, 1 xfailed.

## Measurements

Full run of the official script on a copy migrated through phase 4 (`WEB_BENCH_LABEL=stack_fixed`,
`/tmp/web-scale-bench/stack_fixed/summary.txt`; phases 3 and 4 change only the task list's columns and indexes),
against the base and phase 1, median of 5 runs, milliseconds, SQL / everything else:

| Page                    | Base                     | Phase 1                  | This branch           |
| ----------------------- | ------------------------ | ------------------------ | --------------------- |
| `metrics_all`           | 10 757 (2 559 / 8 199)   | 9 252 (5 079 / 4 173)    | 4 077 (3 949 / 127)   |
| `metrics_30d`           | 412 (120 / 292)          | 307 (157 / 150)          | 316 (302 / 14)        |
| `metrics_org_all_user`  | 82 270 (17 884 / 64 386) | 51 406 (17 863 / 33 544) | 16 501 (15 832 / 668) |
| `metrics_org_all_model` | 80 192 (18 003 / 62 189) | 47 815 (16 650 / 31 165) | 22 320 (21 661 / 659) |
| `metrics_org_30d`       | 4 603 (1 756 / 2 848)    | 2 970 (1 590 / 1 380)    | 3 293 (3 259 / 34)    |
| `diagnostics_all`       | 7 464 (2 257 / 5 206)    | 3 156 (2 199 / 957)      | 3 118 (2 165 / 954)   |

The organization's short periods, grouped by project, `compute_user_metrics` alone on the same copy, six loads in a
row, phase 1's code against this branch's: today 10 against 27 ms, 7 days 740 against 1 030 ms, 30 days 2 870
against 3 330 ms. The page narrowed to the power user's largest project loads seven times on one connection at
1.23 s (all time) and 0.24 s (30 days) each time, every statement on custom plans; the organization's 90 days
narrowed to its largest project at 3.8 to 4.1 s.

What the numbers say:

- Python is out of the picture: 127 ms outside SQL for the power user's all time (4.2 s in phase 1), 670 ms for the
  organization's (31 to 34 s), most of it rendering. The page's memory no longer grows with the period.
- The all-time pages are 2 to 3 times faster than phase 1. The organization's all-time page is still slow: 16.5 s
  by user, 22 s by model, which also counts its distinct tasks apart. Each of its statements reads the 3.73 M
  completions again (parallel scan, hash join to the 170 k tasks) and sorts them on disk: the two-column owner join
  is still estimated at 21 k rows, so Postgres sorts for the GROUP BY instead of hashing, and a `count(DISTINCT
...)` always sorts. Without the owner check the same breakdown statement estimates 1.42 M rows, hashes, and takes
  2.2 s instead of 4.6 s.
- The reader's own 30 days are as fast as in phase 1. The organization's short periods stay slower than in phase 1
  (the figures above): three or four statements each pay the scan and the JIT compilation (1.0 to 1.3 s of JIT,
  summed over the workers, on each organization statement at 30 days) where phase 1 paid them once. With `jit = off`
  on the copy the organization's 30 days take 2 470 ms and its 7 days 920 ms.
- With the owner's name joined on the task's user instead, the organization's 7 days take 3.0 s and its today 1.6 s
  (`/tmp/web-scale-bench/stack/`): every statement reads the whole user-led index.

Two alternatives were measured and not kept:

- **A covering index.** `ix_telemetry_events_user_type_created` rebuilt with every summed column in `INCLUDE`
  (Postgres only; 1 075 MB on the bench, 12.4 s to build, a migration `e9f0a1b2c3d4`) turns every metrics statement
  into an index-only scan: `metrics_all` 1 872, `metrics_30d` 106, `metrics_org_all_user` 16 627,
  `metrics_org_30d` 5 199 (`/tmp/web-scale-bench/f2_covering_index/`). It also broke the problem report:
  `diagnostics_all` 20 286 ms (runs 1.5 s, then 11 to 26 s). `model_attribution.completions_by_task` runs once per
  chunk of 500 tasks; after five executions on a connection Postgres switches its prepared statement to a generic
  plan (asyncpg prepares every statement), and the generic plan (`EXPLAIN (GENERIC_PLAN)`) is an index-only scan of
  all the user's completions filtered by task id, chosen because the index now carries every column: 432 k index
  entries per chunk, 9.5 s a statement, against 121 ms for the custom plan. Not shipped: it needs that query or the
  plan cache settled first, which is phase 4's ground.
- **One GROUP BY per task.** Grouping by `(task_id, model, mode, provider, kind, client[, group])` and counting
  distinct tasks in Python (one statement plus the quarters): `metrics_all` 3 537, `metrics_30d` 227,
  `metrics_org_all_user` 15 469 (2 367 outside SQL), `metrics_org_30d` 2 751 (`/tmp/web-scale-bench/f2_design_b/`),
  identical figures (`compare.py`: 0 differences). Faster than this branch and than phase 1 on every page, but
  Python loops over a row per task of the period (173 k for the organization's all time, 1.3 s on the event loop,
  so it would need the worker thread back), which is the cost the plan removes. The prototype is
  `/tmp/f2-scratch/b/append_b.py`.

**The `metrics_daily` table (point 3) is not justified as planned.** Counted on the bench's 4.40 M completions:

| Grain                                              | Rows    |
| -------------------------------------------------- | ------- |
| user, UTC day, model, mode, provider, kind, client | 109 404 |
| user, quarter of an hour, the same names           | 288 635 |
| task, the same names                               | 203 710 |
| task, quarter of an hour, the same names           | 367 364 |
| distinct tasks                                     | 182 834 |

A table by user and UTC day cannot give a reader outside UTC their days, the distinct task counts (a task spans
days), or the project grouping (a project is the task's). The grain that answers everything this page shows is per
task and quarter: 367 k rows, 12 times fewer than the events, maintained by an upsert on every completion. On the
live deployment (34 092 completions, 1 517 tasks) every metrics page is already a few statements over a few
thousand rows, so it is not needed today. It becomes the next step only if organizations of the bench's size are a
real target, since this branch leaves their all-time page at 16 to 22 s. `jit = off` (a deployment setting) and the
per-task GROUP BY above are the cheaper levers before it.

## Caveats

- Four or five statements instead of two on the reader's own page, three or four instead of one in an organization
  (the distinct task count runs unless the page is grouped by project or by user). On the live deployment each is a
  scan of a 208 MB table with an index on the user, so a few tens of milliseconds.
- Costs summed by Postgres may differ in the last bits between two loads of a page (a parallel aggregate adds its
  partial sums in any order). The page shows four decimals.
- The Postgres cases of the new tests use `RECALL_PG_URL`, the variable the CI job already sets for the recall
  tests; the name says recall, the database is the suite's.
