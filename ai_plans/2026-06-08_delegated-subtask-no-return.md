# Fix: delegated subtask finalizes the whole task instead of returning to its parent

**Date:** 2026-06-08
**Branch:** `fix/delegated-subtask-no-return-to-parent` (off `main`)
**Status:** ROOT CAUSE PROVEN BY CODE TRACE → FIX IMPLEMENTED.

---

## 1. Reported symptom

> Start from orchestrator → orchestrator spawns a subtask (e.g. `code`) → the child
> `code` task _ends and "finishes" the whole task_ (shows the top-level completion /
> "Start New Task" UI) instead of returning its result to the parent orchestrator.
> Happens **very often**, started **after the latest zoo-code ports**.

Key qualifier confirmed by the trace: it fails _very often but not literally always_ —
the **first** delegation in a session usually works; the **2nd and later** delegations
fail. That asymmetry is the fingerprint of the bug (see §4).

## 2. Architecture recap (metadata-driven delegation)

A task's persisted `HistoryItem` carries `status` (`"active" | "delegated" | "completed"`)
plus `awaitingChildId`, `delegatedToId`, `completedByChildId`, `childIds`.

- Parent `new_task` → `ClineProvider.delegateParentAndOpenChild()`:
  step3 dispose parent (`removeClineFromStack({skipDelegationRepair:true})` → `abortTask`),
  step4 create child (`initialStatus:"active"`, `startTask:false`),
  **step5** persist parent `{status:"delegated", delegatedToId:child, awaitingChildId:child}`,
  step6 `child.start()`.
- Child `attempt_completion` → `AttemptCompletionTool`: if `task.parentTaskId` and child
  `status==="active"`, it delegates back **only if** the parent reads
  `status==="delegated" && awaitingChildId===child` — otherwise it **falls through** to
  `task.ask("completion_result")` → on accept `emitTaskCompleted()` = finalize whole task.

## 3. The #73 regression (what made a latent bug fatal)

Commit `84ef25e07` (#73, "delegation cancel races") tightened the gate. **Before #73** an
`active` child with a `parentTaskId` delegated to its parent _unconditionally_ (never read
parent status). **After #73** ([AttemptCompletionTool.ts:110-113](../src/core/tools/AttemptCompletionTool.ts))
it requires `parentHistory.status==="delegated" && awaitingChildId===child`. So any path
that leaves the parent _not exactly_ `delegated` now finalizes the whole task. #73 did not
_create_ the bad write below — it converted a previously-tolerated transient state into a
user-visible failure. (#92 is unrelated: it only swapped the drain callback from
`abortStream` to `updateApiReqMsg`; the offending `saveClineMessages` predates it.)

## 4. Definitive root cause (proven by code trace + independent re-verification)

A **detached, fire-and-forget background usage-drain owned by the parent** re-stamps the
parent's persisted `status` back to `"active"` **after** step5 wrote `"delegated"`. Three
independently-verified facts conjoin:

1. **Resumed parent's `initialStatus` is permanently `"active"`.**
   `reopenParentFromDelegation` persists the parent `status:"active"`
   ([ClineProvider.ts:3667](../src/core/webview/ClineProvider.ts)) and recreates it via
   `createTaskWithHistoryItem(updatedHistory)`, which sets `initialStatus: historyItem.status`
   ([ClineProvider.ts:1097](../src/core/webview/ClineProvider.ts)). `Task.initialStatus` is
   readonly, assigned once ([Task.ts:554](../src/core/task/Task.ts)). So from the **2nd**
   delegation on, the orchestrator instance carries `initialStatus:"active"` for life. A
   **fresh** top-level orchestrator has `initialStatus` undefined → `taskMetadata` emits no
   `status` ([taskMetadata.ts:131](../src/core/task-persistence/taskMetadata.ts)) → 1st
   delegation is immune.

2. **The drain is a late, unguarded parent writer.** In the main loop,
   `handleBackgroundUsageDrain` launches `drainStreamInBackgroundToFindAllUsage(...).catch(...)`
   **fire-and-forget, not awaited** ([TaskApiLoop.ts:601](../src/core/task/TaskApiLoop.ts)),
   _before_ the `new_task` tool runs ([TaskApiLoop.ts:560](../src/core/task/TaskApiLoop.ts)).
   The drain binds `const access = this.access` = the parent
   ([TaskStreamProcessor.ts:748](../src/core/task/TaskStreamProcessor.ts)) and keeps consuming
   the same iterator for up to `DEFAULT_USAGE_COLLECTION_TIMEOUT_MS = 5000ms`
   ([:837](../src/core/task/TaskStreamProcessor.ts)); on each usage chunk it calls
   `await access.history.saveClineMessages()` ([:783](../src/core/task/TaskStreamProcessor.ts)).
   `saveClineMessages` has **no abort guard** (only an empty-messages guard,
   [TaskHistory.ts:442-450](../src/core/task/TaskHistory.ts)); it proceeds even after the
   parent was aborted/disposed by delegation, calling
   `emitTokenUsageUpdate → taskMetadata({initialStatus:"active"}) → updateProviderTaskHistory`.

3. **The merge clobbers `status`, preserves `awaitingChildId`.** `taskMetadata` emits
   `status` (gated on `initialStatus`) but omits `awaitingChildId`/`delegatedToId`/`childIds`.
   `TaskHistoryStore.upsert` merges `{...existing, ...item}`
   ([TaskHistoryStore.ts:165](../src/core/task-persistence/TaskHistoryStore.ts)): the late
   `status:"active"` overwrites the stored `"delegated"`, while `awaitingChildId` survives.
   → parent now `{status:"active", awaitingChildId:child}` = the exact failing gate signature.

### Ordering (the race)

```text
t3  delegateParentAndOpenChild step3: abortTask(true) sets abort=true; awaited save lands here (harmless, overwritten next)
t5  step5: updateTaskHistory → parent {status:"delegated", awaitingChildId:child}
t6  step6: child.start()
t7  RACE: late usage chunk (within 5s) → drain captureUsageData → await saveClineMessages()  [NO abort guard]
        → taskMetadata({initialStatus:"active"}) → upsert merge → parent {status:"active", awaitingChildId:child}
t8  child attempt_completion: gate needs status==="delegated" → sees "active" → FALSE
t9  fall through → ask("completion_result") → emitTaskCompleted → WHOLE TASK FINALIZED
```

Note `abort` is already `true` at t7 (set at t3), so an abort-guarded drain save closes the
window. Wider window for weak/local models (streams stay open longer / emit trailing usage).

## 5. Fix (two coordinated edits — both shipped)

**EDIT 1 — root: stop the stale writer.** In `TaskStreamProcessor.createBackgroundUsageDrain`'s
`captureUsageData`, guard the history persist so an aborted/abandoned task never re-stamps
history:

```ts
updateApiReqMsg()
if (!access.abort && !access.abandoned) {
	await access.history.saveClineMessages()
}
```

Right layer: the drain is the sole _un-awaited_ post-step5 writer; guarding it removes the
clobber at its source for all delegation depths and modes. Weak-model-safe (no model
behavior involved) and mode-switch-safe (only suppresses a stale token-usage write on a
dead instance). The guard is at the **drain call site**, NOT inside `saveClineMessages` —
`abortTask` deliberately calls `saveClineMessages` to persist final state, so a global guard
would break that.

**EDIT 2 — defense-in-depth: gate on the durable signal.** Make `awaitingChildId` the
authoritative delegation signal and tolerate a `status` that drifted to `"active"` (the only
drift the clobber can produce). `awaitingChildId` is set _only_ by
`delegateParentAndOpenChild` step5 and cleared (→ `undefined`) by every genuine detach
(`cancelTask`, `removeClineFromStack` repair, `reopenParentFromDelegation`), so it cannot
survive a real detach — keeping #73's cancel-race protections intact.

- `AttemptCompletionTool` gate: delegate when
  `parentHistory.awaitingChildId === task.taskId && parentHistory.status !== "completed"`.
- `reopenParentFromDelegation` re-validation: mirror it — abort only when
  `cancelledDelegationChildIds.has(child)` OR `awaitingChildId !== child` OR `status === "completed"`.
  (Otherwise `delegateToParent` would get `didReopen === false` and still fall through.)

**Rejected alternatives:** excluding `status` from `taskMetadata` globally, or mutating
`initialStatus` — both have wider blast radius and would mask other status-persistence paths.

## 6. Why this is correct across the genuine-detach cases (#73 preserved)

- **User cancels child mid-flight:** `cancelTask` clears `awaitingChildId` → gate &
  reopen both fail → child finalizes standalone. ✔ (also `cancelledDelegationChildIds`
  fail-closed set still checked.)
- **Parent popped/repaired:** `removeClineFromStack` repair clears `awaitingChildId`. ✔
- **Clobber (this bug):** `awaitingChildId` intact, only `status` drifted → now delegates. ✔

## 7. Tests added

- **`AttemptCompletionTool` gate** (`attemptCompletionTool.spec.ts`, new `describe("subtask delegation
gate")` — the delegation path had no prior coverage): delegated-parent → delegates;
  **clobbered parent `{status:"active", awaitingChildId:child}` → still delegates** (the regression);
  genuine detach `{awaitingChildId:undefined}` → finalizes; parent already `completed` → finalizes.
  Assertions key on `reopenParentFromDelegation` being called (delegate) vs
  `ask("completion_result", "", false)` being called (finalize whole task).
- **Drain guard** (`TaskStreamProcessor.usage-drain.spec.ts`, new `describe("…abort/abandon persist
guard")`): live task → `saveClineMessages` called once; `abort:true` → NOT called (but
  `updateApiReqMsg` still runs); `abandoned:true` → NOT called.
- **`reopenParentFromDelegation` parity** (`ClineProvider.delegation-cancel-races.spec.ts`):
  status drifted to `"active"` but `awaitingChildId===child` → returns `true` and writes parent
  `{status:"active", completedByChildId:child, awaitingChildId:undefined}` (proves it passed the
  guard); parent `completed` → `false`; child in `cancelledDelegationChildIds` → `false`. (Existing
  `awaitingChildId:undefined → false` case retained.) Success path uses partial `vi.mock` of the
  task-persistence read/save helpers via `importOriginal` (preserves `TaskHistoryStore`).

## 8. Verification (2026-06-08)

- `npx tsc --noEmit` → exit 0 (clean).
- Targeted suites green: `attemptCompletionTool` (18), `TaskStreamProcessor.usage-drain` (5),
  `ClineProvider.delegation-cancel-races` (6) — all pass.
- Regression-guard sweep of adjacent suites green: `ClineProvider.spec` & `flicker-free-cancel`
  (96 tests), plus `newTaskTool`, `new-task-isolation`, `ask-finalized-dedup`,
  `ask-queued-message-drain`, `validateToolUse` (78 tests). No regressions from the gate/reopen edits.
