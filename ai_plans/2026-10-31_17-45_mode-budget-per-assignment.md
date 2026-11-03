# Mode request budget counts one assignment, not the task's life in a mode

**Status:** done on `fix/mode-budget-per-assignment`
**Related:** `ai_plans/2026-10-30_23-25_mode-request-budget.md` (#1235), the Council modes (#1237)
**Touched:** `src/core/task/TaskApiLoop.ts`, `src/core/task/Task.ts`, `src/core/task/TaskAskSay.ts`,
`packages/types/src/mode.ts`, `schemas/roomodes.json`, `.changeset/mode-request-budget.md`, their specs

## Symptom

A mode with `maxRequests` could be used once per conversation. After its first answer every follow-up added to the
same count, and once the count passed the budget plus the grace requests the task was stopped on the first request
after the user's next message. Switching to another mode and straight back did not help either.

## Evidence

Task `01a191d7` (foreground, mode `council-verifier`, budget 12), requests counted from the resume at 16:13 with
retries skipped: nine user messages, each answered with `attempt_completion`, took the count from 0 to 22. The user's
next message at 17:30:48 was answered at 17:30:52 by `Task stopped: It used its budget of 12 requests in
council-verifier mode`, before any model request. Task `01a19296` got the budget reminder on its second user turn.

## Cause

`handleModeRequestBudget` reset the count only when it saw a different mode at request time. Nothing reset it when a
round ended or the user wrote again, and a switch away and back with no request in between was invisible to it.

## Fix

- `TaskApiLoop.restartModeBudget()` zeroes the count and the reminder flag; the lazy `budgetMode` comparison is gone.
- `Task.setTaskMode` calls it, so every mode switch restarts the budget even with no request in between.
- `TaskAskSay.handleWebviewAskResponse` calls it (through `Task.restartModeBudget`) on every `messageResponse`, the one
  path every typed message, queued message and edited message takes. Button clicks (`yesButtonClicked`) and the
  headless follow-up timeout do not restart it, so a parallel subagent still has one budget for its whole subtask.

## Tests

`TaskApiLoop.mode-request-budget.spec.ts`: a restart starts both the count and the reminder over. `Task.spec.ts`: a
mode switch and a `messageResponse` restart the budget, `yesButtonClicked` does not. Mutations (each of the three new
calls removed in turn) each turned a test red.
