# Cloud: a run's duration is its wall time, not the sum of its subtasks (2026-10-28)

**Status:** implemented on `fix/cloud-run-wall-duration`.
**Related plans:** `2026-10-28_00-21_web-list-run-totals.md` (stored run totals), `2026-10-28_12-00_cloud-hostile-client-bounds.md`.
**Touched:** `self-hosted-cloudapi/src/services/task_tree.py`, `src/models/task.py`, migration
`alembic/versions/f3c4d5e6a7b8_run_wall_duration.py`, `src/web/presenters/{task_rows,task_list}.py`,
`src/web/templates/{tasks_list,_spend}.html`, tests, `.changeset/cloud-task-duration-request-time.md`.

## Symptom

The task list's Duration of a run, and the project group's sum of runs, added up the request time of every subtask.
Subtasks that a task delegates in parallel run at the same time, so the figure was far above the elapsed time. Live
run `01a18279-8d75-7410-91e1-98bdffa1d3c1`: three subtasks started within 16 ms of each other; the list showed 5260 s,
the union of the run's request intervals is 2374 s.

## What was happening

- A task's own `duration_ms` is the sum of its timed messages (`task_messages.duration_ms`, from `api_req_started`
  and `condense_context`, `services/task_summary.py`). One task's requests are sequential, so that sum is right.
- `task_tree._run_totals` stored `run_duration_ms = SUM(member.duration_ms)` over the run's members; the group row of
  `task_list._group_page` sums `run_duration_ms`.
- The row cell and hovers (`task_rows._spend_fields`, `_run_tooltip`) showed `subtree_spend(...).duration_ms`, the
  same sum computed in Python.

## Fix

`run_duration_ms` is the wall time of the run: how long at least one model request of its members was running.

- Interval of a timed message: `api_req_started` is said just before the request is sent, so `[ts, ts + d]`;
  `condense_context` is said after its summary request ended (`TaskContextManager.sayContextChange`), so
  `[ts - d, ts]`. A row without `message_ts` (legacy or hand-made) overlaps nothing known and adds `d`.
- `task_tree._wall_time`: ordered by start, each request adds the part of it past the running `MAX(end)` of the
  requests that started before it; summed per run. One window query, SQLite and Postgres.
- Index `ix_task_messages_timed (task_id, message_ts, duration_ms, q_kind)`, partial `WHERE duration_ms > 0` on
  Postgres, so the query reads the timed messages from the index alone.
- Migration `f3c4d5e6a7b8` creates the index and rewrites `run_duration_ms` of every task in one UPDATE.
- Web: a run row shows `task.run_duration_ms`; its hover reads "X elapsed for the run; its requests add up to S:
  Y this task + Z in N subtasks". The column header hover says that time when subtasks worked at once counts once.
  `Spend` still sums request time and is documented as such.

## Measurements (Postgres 16.15, one `refresh_run_totals` from a leaf, median of 10)

| Synthetic run | Before | After, no index | After, with index |
|---|---|---|---|
| 5000 subtasks, 20 timed + 200 untimed messages each | 13 ms / 28 ms (changed) | ~3.5 s | 214 ms / 370 ms |
| 500 subtasks, same shape | 7 ms | - | 23 ms |

Live data: at most 28 children under one parent, 473 timed messages in total. The migration's UPDATE took 350 ms
over 10.5k tasks and 1.1M messages.

## Tests

- `test_bridge_task_tree.py`: `test_a_runs_duration_is_the_wall_time_of_its_requests` (parallel, one after another,
  nested, condense, no ts, stranger's subtask), SQLite and Postgres; the random-walk oracle computes the wall time
  by counting covered milliseconds. Mutations that turned it red: sum instead of union, condense at `ts..ts+d`,
  comparing with the previous row's end instead of the running maximum, dropping the NULL-start branch.
- `test_migration_drift.py`: `test_run_duration_backfill_stores_each_runs_wall_time` (red with condense at
  `ts..ts+d` in the migration).
- `test_web_tasks.py`, `test_web_presenters.py`, `test_formatting_call_sites.py`, `test_web_task_list.py`: cells,
  hovers and group sums with a wall time below the request sum (red when the cell or hover goes back to the sum).

## Not done

- A group row still adds its rows' durations: two separate runs of one project that ran at the same time, and
  parallel subtasks under the "All" scope (each its own row), count each in full. A true group wall time needs the
  union over every timed message of the group at read time, too slow for the list on a large account.
- The usage metrics page sums request durations of a period (machine time); unchanged.
- `refresh_run_totals` runs on every final message; skipping it when the task's own figures did not change would
  make the 214 ms of a 5000-subtask run happen once per request instead of once per message. Not needed at the
  live sizes.
