# Task list and quality panel indexes on Postgres (2026-10-28)

**Status:** implemented on `feat/web-pg-indexes` (base `feat/web-list-subtree-rollup`, phase 3), phase 4 of the master
plan.
**Related plans:** `2026-10-27_22-05_web-ui-db-query-scale.md` (master plan, phase 4 "indeksy Postgres"; the bench
is its `scripts/web_scale_seed.py` and `scripts/web_scale_measure.py`); `2026-10-28_00-21_web-list-run-totals.md`
(phase 3, whose `ix_tasks_parent_user` this branch builds on).
**Touched:** `self-hosted-cloudapi/src/models/task.py`, `src/web/presenters/task_list.py`, migration
`alembic/versions/f1a2b3c4d5e6_task_list_indexes.py`, `tests/test_migration_drift.py` (docstring).

## Problem, measured

On the bench (200k tasks, 2,000 users, the power user with 20,000 tasks, 8,000 of them runs; PostgreSQL 16.15
with default settings like the live server) these statements of the task list and of the metrics page's quality
panel read far more rows than they return. Measured on the bench base with its code; phase 3 leaves the statements
as they are:

| Statement (power user, custom plan)            | Base ms | Plan on base                                                              |
| ---------------------------------------------- | ------: | ------------------------------------------------------------------------- |
| `_reader_projects` (project names of the list) |    91.8 | 400 visible org projects, each probing `ix_tasks_project_id`, 55k buffers |
| `_filter_suggestions` `SELECT DISTINCT models` |    15.0 | bitmap heap scan of the user's 20k rows                                   |
| `all_total` `count(tasks.id) WHERE user_id`    |     8.7 | bitmap heap scan of the user's 20k rows                                   |
| quality panel, organization, 30 days           |    77.8 | every run of every user, 77k filtered                                     |
| quality panel, organization, 90 days           |    84.0 | same                                                                      |

Timings are the median of five `EXPLAIN ANALYZE EXECUTE` runs of the app's statements, prepared with the app's
parameters, on a fresh copy of the bench template. The run count (`user_id = ? AND parent_task_id IS NULL`, 63.6 ms
on base) is answered by phase 3's `ix_tasks_parent_user (parent_task_id, user_id)` as one index range.

## What was happening

- The quality panel (`quality_overview.py:62-70`) filters `parent_task_id IS NULL` and a period. No index held an
  organization's or a user's runs in `updated_at` order, so the organization's panel read every run, and a user's
  panel of a period every run of the user.
- `_reader_projects` asks for the visible projects that hold one of the reader's tasks. The planner loops over the
  400 projects of the organization and, per project, reads all its tasks through `ix_tasks_project_id` to find one
  of the reader's; each org project holds about 226 tasks of other users.
- `count(tasks.id)` needs the id of each row, which no index on `user_id` holds, so Postgres 16 visits the heap for
  every counted row; `count(*)` can be answered by an index-only scan.
- `_filter_suggestions` reads `models` of every task of the user from the heap.

## Fix

Four indexes on `tasks`, declared in the model and created by migration `f1a2b3c4d5e6`, one index dropped, and one
helper:

- `ix_tasks_user_roots (user_id, updated_at) WHERE parent_task_id IS NULL` and
  `ix_tasks_org_roots (organization_id, updated_at) WHERE parent_task_id IS NULL`: the runs of a user or an
  organization, newest first, for the list's pages of runs and the quality panel's runs of a period.
  `postgresql_where` only; SQLite (the tests) builds them whole.
- `ix_tasks_project_user (project_id, user_id)` replaces `ix_tasks_project_id`: one index probe per visible project
  answers "does the reader have a task here", and the leading `project_id` serves every lookup by project as before
  (`projects.py`, `recall_cards.py`, the `ON DELETE SET NULL` of `fk_tasks_project_id`).
- `ix_tasks_user_models (user_id, models)`: the model picker's distinct labels from the index alone. The picker
  keeps offering every model of every label, as the list's model filter matches any model in the label. A btree
  entry holds at most 2,704 bytes, and the label comes from the client's model ids; phase 1 cuts each name to
  256 bytes (`telemetry_vocab.clean_name`) and phase 3 keeps the label within 2,000 bytes
  (`model_attribution.LABEL_MAX_BYTES`), so every write of a label fits.
- `ix_tasks_user_id` is dropped. `ix_tasks_user_updated` leads with `user_id` and serves every lookup it served (the
  `ON DELETE CASCADE` from `users` too). On a copy migrated to the stack top it had 0 scans over every page of the
  bench and over the capture of 49 list, quality-panel and recompute statements, and dropping it changed no plan of
  those statements, custom or generic.
- `task_list._count` counts with `count(*)` (`select(func.count()).select_from(Task)`), used for `all_total` and the
  list's total. With `count(tasks.id)` the custom plan of the run count stayed on the heap on base (64.0 ms with
  `ix_tasks_user_roots` in place); with `count(*)` it is an index-only scan.

The migration is plain `CREATE INDEX`; on the bench copy `alembic upgrade head` from phase 3 took about a second,
and its downgrade restores phase 3's indexes. Before `ix_tasks_user_models` it rebuilds every stored label over
2,000 bytes, and its `primary_model`, with frozen copies of the two rules: the base code stored labels of any
length, and one beyond 2,704 bytes (a model id of 3,000 bytes, 150 model ids of 24 characters in one task) made the
`CREATE INDEX` fail and the whole upgrade roll back, so the API would not start. Only labels longer than 500
characters are read; the live database has none over 41. The live table has 1,519 rows. The live role (`roo`) is a superuser; no
extension is needed by what this branch keeps.

## Candidates rejected, with the numbers

- **pg_trgm GIN on `tasks.title`, `tasks.workspace_path`, `projects.name`.** Built on a base copy (title 31 MB in
  3.8 s, workspace_path 9.7 MB). The planner never uses the two `tasks` indexes: the search is an OR of
  `title ILIKE`, `workspace_path ILIKE` and `project_id IN (subquery)`, and the subquery arm cannot join a BitmapOr,
  so the whole OR stays a filter on the user's rows (search count 72.1 ms with them, 73.5 ms without). It does use
  `ix_projects_name_trgm` for the subquery, which saves under 1 ms (a seq scan of 2,908 projects). For a common word
  (`deploy` is in 12 % of titles) a trigram index would also return far more rows than the user owns. Nothing kept,
  so no `CREATE EXTENSION`.
- **The plan's composites `(organization_id, parent_task_id, updated_at)` and `(user_id, parent_task_id, ...)`.**
  Built as `(organization_id, parent_task_id, updated_at)` and `(user_id, parent_task_id, updated_at)` on a base
  copy: the same statement times as the partial indexes (run count 1.09 ms, organization quality 30 days 1.16 ms, 90
  days 4.30 ms), at 12 MB and 17 MB against 3.1 MB and 4.5 MB, since they index the 120k subtasks too. And
  `parent_task_id IS NULL` does not fix that column for the index order, so the generic plan of the first runs page
  becomes a bitmap scan plus a sort (8.15 ms against 0.09 ms).
- **`ix_tasks_parent_user` made partial (`WHERE parent_task_id IS NOT NULL`).** Measured on the stack top. Phase 3's
  index already serves the counts this was meant for (search count 21.1 ms, model filter count 10.9 ms), and under
  the generic plans the app's prepared statements settle on, nothing improves and some statements get slower: the
  grouped list's GROUP BY 8.9 to 11.3 ms and 7.4 to 10.5 ms, the personal quality panel of all time 4.0 to 7.0 ms,
  the model filter's rows 11.2 to 15.4 ms. Only the custom plan of the runs page 300 gains (36.7 to 25.8 ms), and the
  index shrinks from 5.3 to 4.7 MB, since its NULL entries deduplicate.
- **`(user_id, project_id)` in place of `ix_tasks_user_id`.** `_reader_projects` runs on every list page; its custom
  plan takes 1.15 ms, its generic plan 17.5 ms (a bitmap scan of the user's 20k rows to read `project_id`). This
  index makes both 3.6 ms (index-only, 2.0 MB), so it helps only while the list's statements run on generic plans,
  which is a deployment choice (see Caveats); under custom plans it is slower than the probes it replaces.

## Tests

`test_migration_drift.py::test_list_indexes_rebuild_labels_too_long_for_the_models_index`: a label with a 3,000-byte
model id behind a tab and one of 150 model ids are rebuilt from their cleaned names within 2,000 bytes, most-used
first, with their primary model; a normal label and its primary model stay as they are. Without the rebuild it
fails (SQLite has no btree limit, so the test checks the rebuilt labels; the failing `CREATE INDEX` itself was
checked by hand on PostgreSQL 16.15). Existing tests cover the indexes, and each mutation below turned one red,
then was reverted:

- dropped `op.create_index("ix_tasks_user_models", ...)` from the migration: `test_migrations_reach_the_models`
  reports `add_index ix_tasks_user_models`;
- kept `ix_tasks_project_id` (no `drop_index`): the same test reports `remove_index ix_tasks_project_id`; likewise
  for `ix_tasks_user_id`;
- a wrong index name in the downgrade: `test_a_fresh_database_downgrades_through_the_chain` fails;
- `_count` without its conditions: `test_web_task_list.py::test_the_count_names_what_it_counts` fails.

The partial predicates are invisible to that drift check: SQLite builds the indexes whole, and alembic's
`compare_metadata` ignores `postgresql_where` on Postgres too (checked by recreating `ix_tasks_org_roots` without
it on a throwaway database: no difference reported). Checked by hand instead, and noted in the drift test's
docstring: on PostgreSQL 16.15 both the migrated bench copy and `create_all` (`tests/test_recall_pg.py` run with
`RECALL_PG_URL` on a throwaway database of the bench server) show `WHERE parent_task_id IS NULL` on both indexes.
The migration's upgrade and downgrade also ran on the migrated bench copy: down to phase 3's five indexes, up to
this branch's seven.

Full suite at the top of the stack (`feat/web-metrics-rollup`, on phases 1 to 4, the hostile-client bounds and the session settings), with the Postgres lane (`RECALL_PG_URL`): 1585 passed, 1 xfailed.

## Measurements

The official script (`web_scale_measure.py`), median of 5 runs. Phase 3 alone (`/tmp/web-scale-bench/f3/summary.txt`,
phase 3 on the bench base) against the stack top with this branch (`/tmp/web-scale-bench/stack_fixed/summary.txt`, a
copy migrated through phases 1 to 4); phases 1 and 2 do not touch the list:

| Page (median ms)   | phase 3 | stack top |
| ------------------ | ------: | --------: |
| list_default       |     314 |       125 |
| list_group_model   |     136 |       110 |
| list_group_cost    |    1492 |      1362 |
| list_flat          |      76 |        40 |
| list_flat_cost     |     614 |       557 |
| list_flat_page_300 |      94 |        53 |
| list_search        |      90 |        59 |
| list_model_filter  |      79 |        49 |

Every list page runs the project names, the model picker and `all_total`, which save about 105 ms of SQL between
them for this user; the rest of the cost-sorted views is rendering.

What each index buys on the stack top: the statement with the index, then on the same copy with only that index
dropped (in a rolled-back transaction), custom plans, median of five runs:

| Index                   | Statement                               | With ms | Without ms |
| ----------------------- | --------------------------------------- | ------: | ---------: |
| `ix_tasks_project_user` | `_reader_projects`                      |    1.15 |       91.8 |
| `ix_tasks_user_models`  | `_filter_suggestions` `SELECT DISTINCT` |    1.65 |       18.1 |
| `ix_tasks_user_roots`   | quality panel, personal, 90 days        |    0.75 |        7.4 |
| `ix_tasks_user_roots`   | runs page 300 (generic plan)            |    16.8 |       22.9 |
| `ix_tasks_org_roots`    | quality panel, organization, 30 days    |    1.65 |        4.6 |
| `ix_tasks_org_roots`    | quality panel, organization, 90 days    |    4.92 |       20.5 |

The `_reader_projects` figure without `ix_tasks_project_user` is the base copy's, where `ix_tasks_project_id` was in
its place. The organization's all-time panel stays at about 90 ms: 68k of the 80k runs are the organization's, read
through `ix_tasks_organization_id`. None of the changed statements reaches the JIT threshold.

## Caveats

- The power user owns 10 % of the bench's tasks. For a user with a median or p90 task count every list statement is
  already under 2 ms, before and after.
- Index-only scans (`count(*)`, the model picker) skip the heap only for pages the visibility map marks all-visible;
  rows updated since the last autovacuum still cost a heap visit. Most of a large history is old.
- A task row update that changes `updated_at` (every own write) is not HOT, so it writes every index of `tasks`:
  against phase 3 two more for a run (the two partial root indexes and the models index in, `ix_tasks_user_id`
  out) and as many for a subtask; the project index is replaced, not added. The run-total updates of phase 3 keep
  `updated_at` and change only columns no index holds, so they can stay HOT.
- A label keeps at least its seven most-used models whole; a task that ran through more models than fit 2,000 bytes
  loses the least-used ones from its badge tooltip, its model filter and the picker. The live labels are at most 41
  characters. Dropping `ix_tasks_user_models` instead would cost about 20 ms on every list page of a 20,000-task
  user (measured: `list_flat` 38 to 62 ms).
- Under the generic plans the app's prepared statements reach after five executions on a connection, some list
  statements are much slower than their custom plans: `_reader_projects` 1.15 against 17.5 ms, the anchor of
  `descendant_ids` (the subtask trees) 1.1 against 94 to 350 ms, so `list_default` goes from about 50 ms of SQL to
  about 280 ms from the sixth request on a connection. `plan_cache_mode = force_custom_plan` for the engine's
  connections fixes all of them at 1 to 2 ms of planning per page; it is a deployment choice left to the owner.

## Deploy

Migration `f1a2b3c4d5e6` revises `f0a1b2c3d4e5`, phase 3's run totals. No extension; the only data change is the
rebuild of labels over 2,000 bytes (none on the live deployment). The api image picks it up on start.
