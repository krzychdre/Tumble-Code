# Cloud web: subtasks as a tree instead of a list

**Status:** done on `feat/cloud-web-subtask-tree` (off `main` `e7341a1b5`), committed, not pushed.
First of three stacked branches; `feat/cloud-web-remote-access` and `feat/cloud-web-run-cost-rollup` sit on top.
**Related plans:** `2026-07-30_cloud-web-gui-overhaul.md` (branch 4 introduced `task_relations`,
`tasks.parent_task_id`, the "Runs / All" scope and the subtask panel), `2026-09-23_cloud-web-run-cost-rollup.md`
(builds its sums on the tree loaded here).
**Touched:** `self-hosted-cloudapi/src/services/task_tree.py`, `src/routers/web.py`,
`src/web/templates/tasks_list.html`, `src/web/templates/task_detail.html`, `src/web/static/tasklist.js`,
`src/web/static/app.css`, `tests/test_web_and_share.py`, `tests/test_browser_js.py`,
`tests/browser/tasklist_checks.html`, new `tests/browser/tasktree_checks.html`

## Request

"I would like to see subtasks in tree mode, not as a list."

## What the panel did before

- `/app` (scope `roots`, the default) listed runs only. A run with subtasks showed a count pill in its
  title; the subtasks themselves were not on the page at all.
- `/app?scope=all` listed every task flat, a subtask marked with `↳`, with no indication of which run
  it belonged to.
- The task page's "Subtasks" panel listed the **direct children only** (`task_tree.children_of`), so a
  subtask that delegated further was a dead end until opened.

Live corpus (clone of `roo_cloud`, 2026-09-23): 37 runs, 17 subtasks, all at depth 1. The code handles
any depth; depth 2 was checked on the clone by re-parenting one subtask.

## Change

**One loader for the tree.** `task_tree.subtrees(db, ids, user_id)` returns every stored task beneath
the given ids, grouped by parent, oldest first. It walks one tree level per query (same approach as
`share_service._with_descendants`, so it runs on SQLite and Postgres alike), is scoped to the user, and
is bounded by a seen-set seeded with the requested ids plus `max_depth`: a cycle in the client-supplied
parent links ends the walk instead of producing a tree that contains itself. `subtree_size()` counts a
node's descendants. `child_counts()` and `children_of()` had no other callers and are gone.

**List page, scope `roots`.** Each row is now a `li.task-node` holding the row (`div.task-item`) and,
when it has subtasks, a `ul.task-children` rendered recursively (`{% for … recursive %}`), folded shut
with `hidden`. A toggle button (`aria-expanded`, `aria-controls`) sits in a gutter in front of the row
link; the gutter widens with depth (`--depth`), which is what indents a subtask. The figure columns are
fixed grid tracks anchored at the right end of the link, so a narrower link only shortens the title and
the numbers stay in the same columns. "Expand all / Collapse all" appears next to "Select page" when
the page has a tree.

**Scope `all`** stays flat (nesting there would show every subtask twice); it keeps the `↳` marks.

**Task page.** The panel renders the whole subtree nested, indented per level with a `↳` marker; the
count is the number of tasks in the subtree.

**Without JavaScript** a `<noscript>` style unfolds every subtree and hides the toggles, so nothing on
the page is a dead control (the file's existing progressive-enhancement rule).

## Selection had to learn about folded rows

With subtasks on the page, three selection behaviours would have acted on rows the reader cannot see:

| Action                       | Before (flat rows)                   | Now                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Select page"                | every checkbox                       | visible checkboxes only, so folded subtasks are never selected blind                                                                                                                                                                                                                      |
| Shift-click range            | by position among all checkboxes     | by position among visible checkboxes; the anchor is the box itself, and an anchor that was folded away starts no range                                                                                                                                                                    |
| "Include their subtasks (N)" | sum of each row's direct-child count | in the tree: the union of the selected rows' nested checkboxes that are not themselves selected; in the flat view: `data-child-count`, now the size of the whole subtree because that is what `include_subtasks` deletes (it was the direct-child count, which understated a deep delete) |

## Tests

- `test_run_view_nests_subtasks_under_their_run` (replaces `test_task_list_hides_subtasks_by_default`,
  which asserted the old behaviour): both levels inside their parent's folded subtree, in order;
  toggles exactly where there is something to unfold; count pill still counts runs; `data-child-count`
  is the subtree size; the flat view has no nesting and keeps the `↳` marks.
- `test_subtrees_groups_by_parent_oldest_first_within_the_users_tasks`: grouping, spawn order, another
  user's task linked under ours is excluded, `subtree_size`.
- `test_subtree_walk_survives_a_cycle_on_the_page`: a forced A→B→A cycle walks once and the task page
  renders.
- `test_the_tree_costs_a_query_per_level_not_per_run`: counts SELECTs for a page of 5 runs and of 10
  runs; equal. **Verified by mutation:** loading the tree per run made it fail with 23 vs 13.
- `test_task_detail_shows_the_whole_subtree`: a grandchild appears on the root's page, one level in.
- `tests/browser/tasktree_checks.html` (19 checks, headless Chrome): folding, expand/collapse all,
  select-all and shift ranges skip folded rows, the subtask offer counts each nested task once.
  **Verified by mutation:** a copy of `tasklist.js` whose select-all ticks every box fails 4 checks.
- `tasklist_checks.html` fixture updated to the new row markup; its 18 checks still pass.
- Full suite: 202 passed (197 before; one test replaced, five Python tests and one browser harness added).

Visual check (the method from `2026-07-30_cloud-web-gui-overhaul.md`): throwaway api container on a
clone of the live DB, session cookie minted locally, page captured with headless Chrome; the tree with
two runs unfolded and a depth-2 case both render with the figure columns aligned.

## Notes

- Fold state is not remembered across page loads; a run is folded again after navigating back unless
  the browser restores the page from its back/forward cache.
- The project badge column still right-aligns badges of different widths (visible in the user's
  screenshot before this change); not touched here.
- Costs on a run row are still the run's own cost only; that is the third branch.
