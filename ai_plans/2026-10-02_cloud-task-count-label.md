# Cloud web: the task list count says what it counts

## Problem

The task list header read "Your tasks 135" next to a scope toggle "Runs | All 247".
Under the default "Runs" scope the pill counts runs (top-level tasks, with their
subtasks folded beneath them), so 135 is right, but the heading calls them tasks
while the toggle says there are 247 tasks. The two numbers looked contradictory.

## Root cause

`tasks_list.html` rendered the bare `total` (rows of the current view, filters
applied) beside the "Your tasks" heading, with no unit. `all_total` on the toggle
is every task including subtasks.

## Change

- `tasks_list.html`: the pill carries a noun that follows the scope and the
  number: "135 runs" / "1 run" under Runs, "247 tasks" / "1 task" under All.
- `tasklist.js` (`announceCount`): the screen-reader status line reuses the pill
  text instead of parsing a bare number (which would now be NaN) and appending
  "tasks".
- Tests: new `test_the_count_names_what_it_counts`; updated the pill assertion in
  `test_web_tasks.py` and the fixture/expectations in
  `tests/browser/tasklist_filter_checks.html`.

## Not changed

The toggle labels ("Runs", "All N") stay; the toggle count remains unfiltered.
Rollout needs the cloud api image rebuilt.
