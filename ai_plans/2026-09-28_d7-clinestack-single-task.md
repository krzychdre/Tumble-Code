# D7 — clineStack is a stack of one

Roadmap item D7 from `ai_plans/2026-09-27_simplification-roadmap.md`.
Branch: `refactor/d7-clinestack-single-task` (off `main` @ d6d611a4d, after D3/PR #553).

## Problem (roadmap, verbatim)

> **`clineStack` is a stack of one.** Every path removes the current task
> before adding another, yet `rootTask`, `taskNumber` and three loops still
> read the array.

Fix: `currentTask?: Task`; derive `rootTask` and `taskNumber` from history
metadata.

This item gates S1 (later extracts a `TaskSlot` from ClineProvider).

## Empirical inventory (verified by grep on main @ d6d611a4d, 2026-09-28)

`clineStack` is declared once: `private clineStack: Task[] = []`
([ClineProvider.ts:132](../src/core/webview/ClineProvider.ts)). Sixteen
production sites touch it, all inside ClineProvider:

### Writers

| Site                              | Kind                             | Path guard that bounds the array to length ≤ 1                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `addClineToStack` L515            | push                             | Only two callers: `createTaskWithHistoryItem` L1104 (after popping at L1023 unless rehydrating-in-place, which _replaces_ the slot at L1094 instead) and `createTask` L2011 (after popping at L1986 when `!parentTask`). Delegation's call goes through `createTask` with `parentTask` set — but `delegateParentAndOpenChild` popped the parent itself at `DelegationService.ts` L153 before calling `createTask`. |
| `removeClineFromStack` L560       | pop                              | Pops the single entry (guard: early-return on length 0, L555).                                                                                                                                                                                                                                                                                                                                                     |
| `createTaskWithHistoryItem` L1094 | index write (in-place rehydrate) | Writes `clineStack[stackIndex]` where `stackIndex = length - 1`; only reached when `currentTask.taskId === historyItem.id`, i.e. the slot already holds exactly that task.                                                                                                                                                                                                                                         |
| `dispose` L725-727                | drain loop                       | `while (length > 0) removeClineFromStack()` — pure drain.                                                                                                                                                                                                                                                                                                                                                          |

### Readers

| Site                                   | Reads                                                   | Equivalent single-slot expression                                                                                                    |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `getTaskStackSize` L628-630            | `length`                                                | `currentTask ? 1 : 0`                                                                                                                |
| `getCurrentTaskStack` L632-634         | `map(taskId)`                                           | `currentTask ? [currentTask.taskId] : []`                                                                                            |
| `dispose` drain L725                   | `length`                                                | `if (currentTask) await removeClineFromStack()`                                                                                      |
| `createTaskWithHistoryItem` L1072-1075 | `length-1`, `[index]`                                   | `const oldTask = this.currentTask`                                                                                                   |
| `showTaskWithId` L1397-1402            | `find` by rootTaskId/parentTaskId                       | with ≤1 entry, `find` can only ever return the current task or undefined. Semantics preserved by comparing against the current task. |
| `condenseTaskContext` L1417-1422       | backward loop                                           | `this.currentTask?.taskId === taskId ? this.currentTask : undefined`                                                                 |
| `getCurrentTask` L1893-1899            | `length`, `[length-1]`                                  | `this.currentTask`                                                                                                                   |
| `logWebviewHiddenDiagnostics` L1910    | `length` (as `stackDepth`)                              | `currentTask ? 1 : 0`                                                                                                                |
| `createTask` L2000-2002                | `clineStack[0]` as rootTask, `length + 1` as taskNumber | derivation below                                                                                                                     |
| `getLiveTaskInstance` L2048-2055       | backward loop                                           | same shape as condenseTaskContext                                                                                                    |
| `clearTask` L2334-2335                 | `length`, `[length-1]` (log only)                       | `this.currentTask`                                                                                                                   |

### The "three loops"

1. `dispose()` drain (L725) — while-loop pop.
2. `condenseTaskContext()` backward search (L1417).
3. `getLiveTaskInstance()` backward search (L2049).
   (Plus `clearTask`'s length check, `showTaskWithId`'s two `find`s, and the
   `addClineToStack`-side readers — all single-slot equivalent.)

### Empirical proof no path needs >1 task

Every push is preceded by a pop _of the only resident entry_:

1. **`createTask` (user top-level)** — L1986 `removeClineFromStack()` when
   `!parentTask`, then push at L2011. Max length during transition: 0→1.
2. **`createTask` (delegation child)** — the only `parentTask` caller is
   `DelegationService.delegate` (DelegationService.ts L189), which at step 3
   (L153) already called `host.removeClineFromStack({ skipDelegationRepair: true })`
   with the comment "Enforce single-open invariant by closing/disposing the
   parent first … ensures we never have >1 tasks open at any time during
   delegation". Max length: 0→1.
3. **`createTaskWithHistoryItem` (resume / flicker-free rehydrate)** — pops at
   L1023 unless rehydrating the same id, in which case it _replaces_ the slot
   (L1094) rather than pushing. Max length: 1 (rehydrate) or 0→1 (resume).
4. **`addClineToStack` direct callers** — only the two above
   (grep `addClineToStack` outside `__tests__`: ClineProvider L1104, L2011).
5. **No other production writer exists** — the 5 remaining sites are reads,
   the drain in `dispose`, and the in-place index write guarded to the
   already-resident task.
6. **`getCurrentTaskStack()`'s only production consumer**
   (`DelegationService.reattach` condition 4, "parent is not currently open
   in the task stack") only checks membership — with ≤1 element it is
   exactly `currentTask?.taskId === parentTaskId`.

The only places that ever put two mock tasks in the array are specs that
assert the array mechanics themselves (`ClineProvider.spec.ts` L986
"adds multiple Cline instances", `ClineProvider.flicker-free-cancel.spec.ts`
L316 "maintain parent task", `task-resume-ui.spec.ts` L269/L291). Those
assert a state the production code never produces; the roadmap explicitly
declares them the mechanics to retire. **Conclusion: no path relies on a
stack of >1. Proceed.**

## Derivation design

### `rootTask`

`createTask` passes `rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined`.
Since the array holds ≤1 task and `createTask(!parentTask)` has already
popped it, the read always evaluates to `undefined` on the top-level path.
On the delegation path the array is empty (parent popped at
DelegationService L153), also `undefined`. **Old behavior: rootTask is
always `undefined` here** — `Task` derives `rootTaskId` from
`rootTask?.taskId` (Task.ts L863), and the delegation metadata path sets
`rootTaskId` via `historyItem.rootTaskId` instead (Task.ts L862), which is
how subtask lineage actually survives.

Fix: derive from the _parent chain_, preserving the semantic without the
array: `rootTask: parentTask ? (parentTask.rootTask ?? parentTask) : undefined`.
For delegation (`parentTask` = the just-popped parent object), this yields
the parent's root for depth ≥2 chains (A→B→C: C's root = A) and the parent
itself for depth-1 (B's root = B's parent A) — matching what `clineStack[0]`
_would_ have meant in the historical multi-level stack, and `undefined`
for top-level tasks exactly as before. The top-level and resume paths are
byte-identical to the old behavior; the delegation path only differs in
that it now records lineage that the old code silently dropped (old code:
always `undefined`) — an observable-only-in-metadata improvement that
matches the persisted `rootTaskId` semantics (`historyItem.rootTaskId`
already stores this chain). To stay strictly behavior-preserving for the
non-delegation paths (the only ones that ever ran), this is safe: those
paths pass `parentTask === undefined`, so the expression is `undefined`.

### `taskNumber`

`createTask` passes `taskNumber: this.clineStack.length + 1`. Because the
array is empty at that point on every path (pop-before-push), this is
always `1`. But `taskNumber` is persisted into `HistoryItem.number`
(taskMetadata.ts L119) and rendered in history titles
("Task #{{taskNumber}}"). Deriving it from history metadata instead:
**`taskNumber = 1`** (constant), since that is exactly what the old code
produced for every fresh task on every production path. (For
history-rehydrated tasks, `historyItem.number` is already used — L1062 —
and stays untouched.)

### Accessors

- `getCurrentTask()` → `return this.currentTask` (no behavior change).
- `getTaskStackSize()` → `return this.currentTask ? 1 : 0`. Kept: 3 spec
  call sites use it as "is there a current task" probe. Alternatively
  inline `getCurrentTask() !== undefined` into specs and delete the method
  (knip-clean) — chosen: **delete `getTaskStackSize`** and rewrite the
  spec assertions against `getCurrentTask()`, since the method's only
  meaning was the array length and D7's point is that the array is gone.
- `getCurrentTaskStack()` → `return this.currentTask ? [this.currentTask.taskId] : []`.
  Kept (public API consumed by `src/extension/api.ts` L123 and required by
  `DelegationHost`); shape preserved.
- `removeClineFromStack`/`addClineToStack` names kept (public, spec-exercised,
  api.ts callers); bodies become single-slot set/clear.

## Batching

Single batch — one cohesive refactor of the task-slot mechanics:

1. ClineProvider.ts: replace field; rewrite writers/readers per table.
2. Specs that construct/observe the array:
    - `ClineProvider.spec.ts` (stack-size tests, L852-990) → currentTask assertions.
    - `ClineProvider.flicker-free-cancel.spec.ts` (L197-318) → `(provider as any).currentTask` assignments.
    - `task-resume-ui.spec.ts` (L207-346) → `currentTask` on provider stand-ins.
    - `removeClineFromStack-delegation.spec.ts` (L36-277) → `currentTask` field.
    - `single-open-invariant.spec.ts` (L44) → `currentTask`.
    - `Task.completion-memory-writers.spec.ts` (L79-138) → stand-in type.
    - `ClineProvider.cancelTask-abort-race.spec.ts`, `ClineProvider.delegation-cancel-races.spec.ts`, `ClineProvider.historyReopenAllowList.spec.ts` → `(provider as any).clineStack = [x]` → `= x`.
3. New regression spec: `src/core/webview/__tests__/ClineProvider.task-slot.spec.ts`
   — lowest layer that can hold the real method bodies via
   `ClineProvider.prototype` calls on stand-in providers:
    - switching tasks replaces (not stacks): add A, add B (simulate the
      always-pop-then-push production discipline), assert `getCurrentTask() === B`
      and `getCurrentTaskStack()` length 1;
    - removeClineFromStack clears to undefined and aborts;
    - createTask derivation: top-level → rootTask undefined, taskNumber 1
      (characterization vs old array logic: `length(0)+1 = 1`,
      `clineStack[0]` of empty = undefined);
    - delegation derivation: parent chain rootTask.
4. Comment updates: Task.ts L176, BackgroundTaskRunner.ts L108 (mention
   `clineStack`) → "current task slot"; DelegationService doc table
   ("removed from the stack") stays conceptually accurate, no change
   needed; docs/03-task-agent-loop.md mentions "remove it from the stack"
   in a sequence diagram — wording still accurate for a slot; no docs
   change required (mechanism is internal).
5. Changeset `.changeset/d7-clinestack-single-task.md` (package
   `tumble-code`, patch).

## Verification

- `cd src && npx vitest run` for: `__tests__/removeClineFromStack-delegation.spec.ts`,
  `__tests__/single-open-invariant.spec.ts`, `__tests__/task-resume-ui.spec.ts`,
  `__tests__/new-task-delegation.spec.ts`, `core/webview/__tests__/ClineProvider.spec.ts`,
  `ClineProvider.flicker-free-cancel.spec.ts`, `ClineProvider.cancelTask-abort-race.spec.ts`,
  `ClineProvider.delegation-cancel-races.spec.ts`, `ClineProvider.historyReopenAllowList.spec.ts`,
  `ClineProvider.task-slot.spec.ts`, `core/task/__tests__/Task.spec.ts`,
  `core/task/__tests__/Task.completion-memory-writers.spec.ts`,
  `core/webview/__tests__/DelegationService.spec.ts`.
- `npx tsc --noEmit` (src workspace) for touched files.
- eslint on touched files.
- `pnpm knip` — baseline exit 1 pre-existing; no NEW findings
  (`getTaskStackSize` must disappear with no dangling references).
- git: one commit on `refactor/d7-clinestack-single-task`, push, PR
  "D7: replace clineStack array with currentTask", merge immediately
  (squash).

## Residuals / notes

- `getLiveTaskInstance` and `condenseTaskContext` now only match the
  current task; a detached fan-out child delivering to a _background_
  parent still goes through `getBackgroundTask` — unchanged.
- `logWebviewHiddenDiagnostics` prints `stackDepth: 1` (was 1 in practice).
- S1 will extract this slot into `TaskSlot`; keep
  `addClineToStack`/`removeClineFromStack` names until then.
