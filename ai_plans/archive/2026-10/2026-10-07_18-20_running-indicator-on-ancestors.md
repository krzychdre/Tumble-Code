# Running indicator on the ancestors of a working subtask

**Status:** done on `feat/history-running-on-ancestors` (stacked on `feat/history-running-indicator`).
**Related plans:** `2026-10-07_13-00_history-running-indicator.md`, `2026-10-07_12-31_keep-tasks-running-in-background.md`.
**Touched:** `webview-ui/src/components/history/useTaskSearch.ts`, its spec.

## Symptom

Owner request: "jeśli działa subtask - loaded na nim i na tasku głównym". While a subtask works, its row
has the spinner, but the root task row (and every task in between) looks idle.

## What was happening

`TaskSlot.getRunningTasks` lists only the tasks that work themselves. A parent that delegated is
disposed (or rests) while it waits for its child, so `isWorking` is false for it and the host leaves it
out of `runningTasks`. `useTaskSearch` marked a row only when its own id was in the map.

## Fix

`withAncestors` in `useTaskSearch.ts` walks `parentTaskId` (from the full `taskHistory`, not just the
rows of the current workspace or search) from every working task up to the root and gives each ancestor
the subtask's status. `"awaiting_input"` wins over `"running"` on a shared ancestor, so the root row
shows that something in its tree waits for the user. A `seen` set stops the walk on a corrupted parent
cycle.

Done in the webview, not in the host: the host map keeps meaning "this task works", which is also what
the keep-alive rule uses, and the webview already has the parent links.

## Failure surface (before/after)

| Situation                     | Before                            | After                              |
| ----------------------------- | --------------------------------- | ---------------------------------- |
| Grandchild runs               | spinner on grandchild only        | spinner on grandchild, child, root |
| Grandchild waits for approval | attention icon on grandchild only | attention icon on all three        |
| Child waits, grandchild runs  | child: attention, root: nothing   | root: attention                    |

## Tests

`useTaskSearch.spec.tsx`, describe "a working subtask": ancestors marked running, awaiting_input carried
up, awaiting_input wins, parent cycle terminates.

## Caveats

The tooltip on an ancestor row says the same as on the working task ("Working"); it does not say that
the work happens in a subtask.
