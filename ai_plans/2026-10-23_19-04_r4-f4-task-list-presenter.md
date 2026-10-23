# R4 F4: the task list query and paging move into the presenter

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item F4.

## Touched files

- `self-hosted-cloudapi/src/routers/web_tasks.py`
- `self-hosted-cloudapi/src/web/presenters/task_list.py`
- `self-hosted-cloudapi/tests/test_web_tasks.py`
- `self-hosted-cloudapi/tests/test_web_task_list.py`

## Problem

The `/app` route counted the filtered tasks, clamped the page, built the query with the optional rollup join, loaded
the page's subtrees, counted all tasks and ran the two filter-suggestion queries itself, while the presenter
`web/presenters/task_list.py` already owned the `ListView` that produces the filters and the order.

## Change

- `list_page(db, view, user_id, zone, page) -> dict` in `web/presenters/task_list.py` returns the list's template
  context: rows, pager (page, page count, numbered window), totals and the filter suggestions.
  `_filter_suggestions` and `PAGE_SIZE` move with it.
- `task_list` in `routers/web_tasks.py` parses the request into a `ListView` and renders `list_page(...)`.
  `select(` in the router drops from 6 to 1.
- The `or 0` after the two `count()` scalars is dropped: `COUNT` always returns a number.
- Tests that shrink the page size patch `task_list.PAGE_SIZE` in the presenter.

## Tests

- `test_web_tasks`, `test_web_task_list`, `test_cloud_web_perf`, `test_route_table`: 125 passed. Full suite: 1348
  passed, 1 xfailed. ruff clean.
- Mutation checks: an offset of `page * PAGE_SIZE` turns 52 tests red; no upper clamp on the page turns 1 red; empty
  model suggestions turn 1 red.
