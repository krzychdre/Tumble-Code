# Cloud web: run cost cut off at 20 subtask levels - investigation & fix

**Status:** fixed on `fix/cloud-web-deep-subtree-rollup`
**Related plans:** `ai_plans/2026-09-23_cloud-web-run-cost-rollup.md` (the Σ rollup this repairs), `ai_plans/2026-09-23_cloud-web-subtask-tree.md` (the 20-level walk)
**Touched:**

- `self-hosted-cloudapi/src/services/task_tree.py` (new `descendant_ids`, `subtrees` rewritten on it)
- `self-hosted-cloudapi/src/services/share_service.py` (`_with_descendants` uses `descendant_ids`)
- `self-hosted-cloudapi/tests/test_web_tasks.py` (three regression tests, one query-count test widened)

## Symptom

The task list (2026-10-07) showed the run "kryształy nadal nie są przezroczyste..." as
`Σ 1.6M tok`, `Σ $0.7431`, its first subtask `Σ $0.5045`, the next `Σ $0.4690`, and so on, each
row only about $0.018 less than the one above.

## What was happening

The run is a chain of 91 subtasks nested 90 levels deep (checked in Postgres with a recursive
query): a GLM subtask could not see a screenshot, the "image not supported" notice told it to
delegate to a vision-capable mode, it delegated to Ask mode on the same text-only model, and every
new subtask did the same.

`task_tree.subtrees` walked the tree one level per query with `max_depth=20`. Levels 21..90 were
never loaded, so `subtree_spend` summed levels 0..20 only:

| figure | levels 0..20 (shown) | all levels (real) |
| ------ | -------------------- | ----------------- |
| cost   | $0.7431              | $3.6138           |
| tokens | 1,565,717            | 6,795,401         |

The first subtask's `Σ $0.5045` is the same cut seen one level down (levels 1..20).

Two more places had the same cut or disagreed with it:

- Sorting the list by cost or tokens uses `task_list._run_totals`, a recursive CTE with no depth
  limit, so the list was ordered by $3.61 while showing $0.74.
- `share_service._with_descendants` (bulk delete "include their subtasks") had its own 20-level
  walk. Deleting this run would have removed 21 tasks and left 71 behind, re-parented to NULL by
  the foreign key, i.e. as 71 new top-level runs.

The depth limit was there to stop a cycle in client-supplied parent links, but both walks already
ended on a cycle by themselves (a task is visited once), so the limit only ever cut real trees.

## Failure surface (before/after)

| scenario                                   | before                                | after                         |
| ------------------------------------------ | ------------------------------------- | ----------------------------- |
| run deeper than 20 levels, list Σ          | first 21 levels only                  | whole run                     |
| same, task page "whole run" / "N subtasks" | cut at 20                             | whole run                     |
| same, sort by cost/tokens                  | full sum (inconsistent with the cell) | full sum, same as the cell    |
| bulk delete with subtasks                  | 21 deleted, rest orphaned             | all deleted                   |
| cycle in parent links                      | terminates                            | terminates (UNION in the CTE) |
| SELECTs for a page of runs                 | one per tree level                    | one in total                  |

## Fix

`task_tree.descendant_ids(task_ids, user_id)` returns a SELECT over a recursive CTE (the same
construct `_run_totals` and `_ancestor_query` already use on SQLite and Postgres). It uses UNION,
not UNION ALL, so a row already produced is not produced again and a cycle runs dry. There is no
depth limit.

`subtrees` loads every descendant row with that one query and assembles the tree in Python level
by level from the requested ids, keeping the old rules: children oldest first, each task under
one parent, the edge that would close a cycle is cut.

`_with_descendants` executes the same SELECT and appends the ids it did not already hold.

## Tests

- `test_a_run_deeper_than_twenty_levels_is_summed_whole`: a 31-task chain at $0.01 each; the list
  row shows `Σ $0.3100` and 30 subtasks, the task page shows $0.3100 / $0.3000.
- `test_bulk_delete_reaches_below_twenty_levels`: deleting the 31-task chain removes 31 tasks.
- `test_the_tree_costs_the_same_queries_whatever_the_runs_or_depth` (was
  `..._a_query_per_level_not_per_run`): the second batch of runs is now four levels deep, and the
  page must still cost the same number of SELECTs.

All three were run against `origin/main` code in a scratch export and fail there (`$0.2100`
shown, `21 == 31`, `9 == 7` SELECTs); they pass on the branch. Full cloudapi suite: 1316 passed,
`make lint` clean.

## Notes

- Not fixed here: the delegation loop itself (Ask subtask re-delegating the image to another Ask
  subtask on the same text-only model). That is a separate extension-side bug and the real source
  of the $3.37 spent below the first level.
- `ancestors()` still stops at 10 levels, so the breadcrumb of a task 90 levels down shows its
  10 nearest ancestors only. That is a display choice, not a sum, and is left as is.
- Goes live only after the api image is rebuilt.
