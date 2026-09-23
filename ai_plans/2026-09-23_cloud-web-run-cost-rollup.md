# Cloud web: a run's cost includes its subtasks

**Status:** done on `feat/cloud-web-run-cost-rollup` (stacked on `feat/cloud-web-remote-access`), committed, not pushed.
Third and last of the stack; this is the branch to push.
**Related plans:** `2026-09-23_cloud-web-subtask-tree.md` (the tree this sums over, and the `subtrees()` fix this
branch's tests uncovered), `2026-07-30_cloud-web-gui-overhaul.md` (the denormalized task summary columns).
**Touched:** `self-hosted-cloudapi/src/services/task_tree.py`, `src/routers/web.py`, new
`src/web/templates/_spend.html`, `src/web/templates/tasks_list.html`, `src/web/templates/task_detail.html`,
`src/web/static/app.css`, `tests/test_web_and_share.py`

## Request

"Count a task's cost correctly. Every task and subtask seems to be counted, but the list has no sum, so it
shows the parent's cost, often many times lower than the whole."

## What was happening

Each task row carries its own figures, rolled up from its own conversation's `api_req_started` messages
(`services/task_summary.refresh_task_summary`). A subtask is a separate task with its own conversation, so a
run's row showed the parent's share only. From the live DB:

| Run                                            | Row showed | Its subtasks | Whole run |
| ---------------------------------------------- | ---------- | ------------ | --------- |
| Analyse issue described in 1289652 ADO…        | $0.1656    | 2, $1.2434   | $1.4090   |
| Implement changes described in @/private_docs… | $2.7498    | 4, $4.2251   | $6.9749   |
| how do you know, that def \_\_handle_missing…  | $0.0497    | 1, $0.1499   | $0.1996   |
| Przygotuj projekt (wciągnij main…)             | $0.6350    | 10, $9.8707  | $10.5056  |

**The figures are disjoint, so a plain sum is exact.** Checked against the `LLM Completion` telemetry, which is
stamped with the task id of the request that produced it: every task's stored cost equals the cost of the
completions carrying its own id (the ADO run: parent $0.1656 over 13 completions, subtasks $1.1940 over 46 and
$0.0493 over 3). A parent's cost does not already contain its subtasks', so nothing is counted twice. All 17
parent links on the corpus have a stored child (no subtask known only from telemetry), so the stored tree is the
whole run.

**Duration and message count are not summed.** All 17 subtasks lie inside their parent's first/last message
(`first_ts`/`last_ts`), so adding their spans would count the same minutes twice; a message count belongs to one
conversation.

## Change

- `task_tree.Spend`: the additive figures of a task row (cost, tokens in/out, cache reads/writes), with `+`/`-`.
  `subtree_spend(tree, task)` sums a task and every stored task beneath it, over the tree `subtrees()` already
  loads for the page, so the rollup costs no query.
- `web._spend_fields` builds the tokens and cost cells for both the list rows and the subtask panel entries: a
  task with subtasks shows its subtree's totals, marked `Σ`, and each cell's own hover gives the split
  ("$1.4090 for the run: $0.1656 this task + $1.2434 in 2 subtasks"); a task without subtasks is unchanged. The
  two cells live in one macro (`_spend.html`) so the list and the panel cannot drift apart.
- The row's hover, for a task with subtasks, heads its own breakdown "This task" and adds a "Σ With its N
  subtasks" block with the run's in/out/cache/cost.
- The task page's subtask panel states the run in its header: "Σ run $10.5056 · 322.8M tok = this task $0.6350 +
  subtasks $9.8707". The page's other figures (quality panel's cost per turn, the live header) stay this task's
  own: they describe this conversation.
- Applies in both list scopes: the flat view shows the same totals for the same tasks.

In the expanded tree the numbers read like directory sizes in a file manager: a run shows its total, its subtasks
show their parts, and a subtask that delegated further shows its own total, also marked.

## Tests

- `test_a_run_row_shows_what_the_whole_run_cost`: a run ($0.25) with a leaf subtask ($1.00) and a subtask
  ($0.50) that has its own leaf ($0.25). The run shows Σ $2.0000 and Σ 9.9k tokens with the split in the hover;
  the middle subtask shows Σ $0.7500; leaves show their own figures unmarked; the flat view shows the same.
- `test_the_run_hover_separates_the_task_from_its_subtasks`: order and content of the two hover blocks, and no
  split on a task without subtasks.
- `test_the_task_page_states_the_run_total`: the panel header's total and split, the panel rows following the
  list's rule, no run total on a leaf's page.
- `test_subtree_spend_adds_every_level_and_nothing_else`: the sum over two levels, a task outside the tree, and
  the subtraction used for "in subtasks".
- **Verified by mutation:** making the cells use the task's own figures again fails the three page tests.
- The flat-view assertion failed at first: it exposed a bug in `subtrees()` from the first branch (a subtask on
  the same page as its parent was never attached). Fixed on that branch, where it belongs, and this branch
  rebased; see the subtask-tree plan.
- Full suite: 227 passed.

Visual check on a clone of the live DB (throwaway container, headless Chrome): the ADO run reads Σ $1.4090 and
Σ 3.4M tok, "Implement changes…" Σ $6.9749 and Σ 14.5M tok; the columns stay aligned with the marker in place.

## Notes

- A subtask that was never shared has no row, so its cost cannot be summed here; the metrics page, built from
  telemetry, still counts it. None exist on the live corpus today.
- Tokens are rolled up with the cost for the same reason (a run's row whose cost includes its subtasks while its
  tokens do not would give a nonsense cost per token); the hover names both parts.
