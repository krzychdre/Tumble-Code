# Cloud web: one account of what a task spent, at the top of its page

**Status:** done on `feat/cloud-web-task-cost-summary` (stacked on `fix/cloud-web-live-header-foreign-state`),
committed, not pushed. Second of three; `feat/cloud-web-phone-layout` sits on it.
**Related plans:** `2026-09-23_cloud-web-run-cost-rollup.md` (the run totals and `Spend`, reused here),
`2026-09-23_cloud-web-live-header-foreign-state.md` (the header fix this builds on).
**Touched:** `self-hosted-cloudapi/src/routers/web.py`, `src/web/templates/task_detail.html`,
`src/web/static/live.js`, `src/web/static/app.css`, `tests/test_web_and_share.py`,
`tests/browser/live_checks.html`, `tests/test_browser_js.py`

## Request

"The task detail screen is not quite readable either. At the top is the parent's cost, below it the costs of
the subtasks. This needs to be unified."

## What was on the page

The ADO analysis run (live DB), three figures, three meanings, no labels saying which:

| Where                    | Showed    | Meant                                       |
| ------------------------ | --------- | ------------------------------------------- |
| Live header, "cost"      | $0.1656   | this task's own conversation                |
| Quality panel, cost/turn | $0.0127   | this task's own cost / this task's 13 turns |
| Subtask panel header     | $1.4090   | the whole run (this task + 2 subtasks)      |
| Task list, same row      | Σ $1.4090 | the whole run                               |

Opening a task from the list made its cost drop eightfold, and the run total sat below the quality panel,
in the header of a panel about navigation.

## Change

- **One spend table at the top** (`_spend_summary`, rendered in the header panel, which now exists whenever
  there is something to show, not only when the bridge is on). Rows: `Σ whole run`, `this task`,
  `N subtasks` (a link to the panel); columns: tokens, in, out, cost. The run row is the list's figure; the
  two rows under it are its parts and add up to it. A task without subtasks shows one row, `this task`.
- **live.js keeps it current**: "this task" from the saved conversation or the live snapshot, as before;
  the run row is recomputed as this task plus the subtasks' stored part, which ships in `live-config`
  (`subtasks: {tokensIn, tokensOut, cost}`). A figure not known yet keeps the server-rendered value.
- **The subtask panel's header loses its total**; its rows add up to the `N subtasks` row at the top.
- **The quality panel states its scope** on a task with subtasks: "This task's own conversation only; each
  subtask below carries its own grade." Its cost per turn no longer reads as a contradiction of the run.
- Shared-link page: unchanged for readers (no figures). The owner's live view there shows the `this task`
  row only (no tree is loaded on that route).

The template imports `_spend.html` as `spend`, so the context variable is `spend_table`; a variable named
`spend` is silently shadowed by the macro module (the first test run caught it).

## Tests

- `test_the_task_page_states_the_run_total` (rewritten): row order run, this task, subtasks; each row's
  tokens/in/out/cost on the priced fixture ($2.0000 = $0.2500 + $1.7500); "3 subtasks" counts the whole
  subtree; `live-config` carries the subtasks' part; no second total in the panel; the scope note; a leaf
  page with one row, no note, no subtasks in its config.
- Share tests: an anonymous reader gets no spend table; the owner's live share page has the `this task` row.
- `live_checks.html`: moved to the new markup, plus 7 checks on the run row (after the conversation's
  figures, after this task's snapshot, untouched by another task's snapshot). 28 checks.
- **Mutation:** dropping the run row update in `showSpend` fails 5 harness checks.
- Full suite: 228 passed.

Visual check (DB clone, throwaway container, headless Chrome, 1440 px): the ADO run reads Σ whole run
3.4M / $1.4090, this task 303.7k / $0.1656, 2 subtasks 3.1M / $1.2434.

## Notes

- The subtasks' part is fixed at render. While a subtask is running, its own page is the live one; the
  parent's run row catches up on reload.
- The extension-side snapshot mislabel (see the header-fix plan) can still put a running subtask's figures
  into the parent's "this task" row through relayed events, until that is fixed in the extension.
