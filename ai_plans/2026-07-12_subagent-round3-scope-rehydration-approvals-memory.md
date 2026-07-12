# Subagent round 3: scope guard, rehydration survival, write approvals, memory visibility

**Date:** 2026-07-12
**Base:** `fix/subagent-no-recursive-spawn` (bf35eb360)
**Status:** IN PROGRESS

## Problems (user-reported)

1. Orchestrator spawns **architect-mode parallel subtasks** — far too big.
   Parallel subtasks should be small one-shot jobs: questions/analysis (ask),
   web research, minor scoped code edits across different files. Architecture
   and planning are serious jobs that belong in the main task.
2. **Fan-out doesn't survive parent rehydration.** After viewing the task
   list and returning, the panel rows are gone and the orchestrator shows
   resume/new-task buttons while the children are still working.
3. **Subtasks write files without asking** even when the user's approval
   settings require permission for writes.
4. **Memory activity is invisible** — extraction/dream writers and recall can
   take real time and the user can't tell they're running.

## Evidence

1. `validateParallelParams` accepts any mode string; the tool description
   never says which kinds of job fit.
2. Three same-session paths rehydrate a live parent from history:
   task-switch round trip (`showTaskWithId` other task → back:
   `removeClineFromStack` pops+aborts, then `createTaskWithHistoryItem`),
   `cancelTask` (in-place rehydrate, ClineProvider.ts ~1145), and the
   streaming-failure rehydrate (ClineProvider.ts:287). All abort the old
   instance → `resume_task` ask → resume buttons. My round-1
   `removeClineFromStack` hook calls `subagentRegistry.clearForParent`
   unconditionally — wiping live rows. Child cancellation is tied to the
   parent instance's `TaskAborted` regardless of WHY it aborted, and the
   fan-out report is pushed into the dead instance's tool context — lost.
   `cancelTask` sets `abortReason = "user_cancelled"` (ClineProvider.ts:3423);
   abandonment rehydrates leave it unset — that's the intent discriminator.
3. `buildSubagentApprovalPolicy`: tool asks with a path inside the child's
   worktree are blanket-approved ("isolation contract"). The user rejects
   that contract: their auto-approval settings must decide. Since round 2 the
   panel can surface asks interactively, so "ask" no longer has to mean
   "deny".
4. Memory writers run via `provider.memorySubTaskRunner` (single chokepoint,
   extraction + dream); recall prefetch via `memoryCoordinator.startPrefetch`
   (memoryTaskIntegration.ts:95, fired from TaskApiLoop.ts:300). Neither
   signals the webview.

## Fix (4 stacked branches)

### B1 `fix/parallel-subtask-mode-guard`

- `validateParallelParams` rejects subtasks whose mode is in
  `DISALLOWED_SUBTASK_MODES = ["architect", "orchestrator"]` with a
  corrective error naming the offending subtask and telling the model to do
  planning itself and fan out only small jobs.
- `run_parallel_tasks` description gains a "good subtask" list (answering a
  question in ask mode, web research, a small scoped edit, running tests)
  and an explicit "never architect/orchestrator subtasks".

### B2 `fix/fanout-survives-parent-rehydration`

- `removeClineFromStack` no longer clears the registry — rows are cleared
  only by the next fan-out (`beginFanOut`) so live children stay visible
  regardless of which task is current.
- Detach instead of cascade-cancel: the tool's `TaskAborted` listener aborts
  the controller only when `task.abortReason === "user_cancelled"` (explicit
  Cancel). Abandonment (task switch, in-place rehydrate, streaming-failure
  rehydrate) leaves children running — per-child cancel remains available in
  the panel.
- Report delivery when the original tool context is dead
  (`task.abort || task.abandoned` after the pool settles): find the live
  instance of the same parent taskId (stack scan) and enqueue the aggregated
  report into its `messageQueueService`. The pending `resume_task` ask's
  queue-drain then auto-resumes the orchestrator with the results; if the
  user already resumed, the report arrives at the next ask boundary.

### B3 `fix/subagent-write-approvals`

- Policy: drop the worktree blanket approval. Read-only actions stay
  auto-approved; everything else (writes ANYWHERE, commands, MCP) delegates
  to `checkAutoApproval` with the user's live settings; `approve` passes,
  `deny` denies, `ask`/`timeout` now return `undefined` — the ask blocks,
  the panel row flips to awaiting_input, the user decides. Protected-file
  guard unchanged.
- Bounded wait split by ask type in TaskAskSay's background fallback:
  followup → approve (empty answer, as today); tool/command/use_mcp_server →
  **deny** (an unattended run must not write without permission; denial
  feedback tells the model the user didn't approve).
- Panel: pending permission asks render Approve/Deny buttons (routed via the
  existing taskId `askResponse` — yes/noButtonClicked).

### B4 `feat/memory-activity-visibility`

- Provider keeps `memoryActivity = { recall: number, write: number }`
  counters; `setMemoryActivity(kind, delta)` posts a `memoryActivity`
  ExtensionMessage and includes the field in state pushes.
- Write side: wrap `memorySubTaskRunner`'s child run. Recall side: hook the
  prefetch lifecycle where it is fired (TaskApiLoop → coordinator), signaled
  through the provider ref.
- Webview: `MemoryActivityBadge` near the chat input (pattern:
  IndexingStatusBadge) — spinner + "Recalling memory…" / "Writing memory…"
  while the respective counter > 0.

## Verification

- Unit: mode-guard validation cases; detach-vs-cancel listener behavior;
  approval-policy delegation matrix (write inside worktree with/without
  alwaysAllowWrite); fallback deny for permission asks.
- `pnpm check-types` (types/src/webview), targeted vitest suites.
- Manual: fan-out → open another task → return: rows visible, children
  running, orchestrator auto-resumes with report after children finish;
  subtask write with auto-approve OFF → panel asks, Deny blocks the write;
  memory badge shows during extraction after a completed task.

## Outcome

(fill at end)
