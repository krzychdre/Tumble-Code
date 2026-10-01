# Parallel work in Tumble Code: orchestrator subagents + worktree windows

**Date:** 2026-06-27
**Status:** Plan (not yet implemented)
**Decisions:** Build **both** the in-process orchestrator (headless subagents in worktrees) **and** the
window-per-agent path. Primary optimization: **speed via decomposition**.

## Context

We have a model that can be called concurrently and want two capabilities in this fork:

1. **Subagents** — decompose one task into pieces that run in parallel for speed.
2. **Parallel work on separate git worktrees.**

This document answers _is it feasible_ (yes, with one real architectural change) and lays out a concrete,
phased build grounded in the current code.

## Feasibility findings (evidence)

Load-bearing facts, each verified in the current tree:

- **Model layer is already parallel-safe.** Each `Task` builds its own handler —
  `this.api = buildApiHandler(this.apiConfiguration)` at `src/core/task/Task.ts:542`. There is **no global
  request mutex/queue**. The only global is the opt-in rate limiter `getLastGlobalApiRequestTime()` used in
  `src/core/task/RetryHandler.ts:95`, active only when `rateLimitSeconds > 0` (default 0).
  → Concurrent model calls work today.
- **`cwd` is already per-Task.** `this.workspacePath = parentTask ? parentTask.workspacePath : (workspacePath ?? …)`
  at `src/core/task/Task.ts:526` and `get cwd() { return this.workspacePath }` at `src/core/task/Task.ts:1297`.
  Terminals, `DiffViewProvider`, `RooIgnoreController`, and checkpoints are all built from `this.cwd`.
  → A task can run against a different directory (a worktree) without touching the opened workspace.
- **A full git-worktree feature already exists.** `src/core/webview/worktree/handlers.ts` +
  `packages/core/src/worktree/worktree-service.ts`. `handleSwitchWorktree` already opens a worktree in a
  **new VSCode window** (`vscode.openFolder … forceNewWindow: true`, `handlers.ts:196`) and auto-opens the
  sidebar via `worktreeAutoOpenPath` (`src/extension.ts:82`).
  → "Parallel work in separate worktrees" already works across windows; Track B just adds ergonomics.
- **Tasks expose a completion event to await.** `task.emit(RooCodeEventName.TaskCompleted, …)` from
  `src/core/tools/AttemptCompletionTool.ts:234`; already consumed via `task.on(RooCodeEventName.TaskCompleted, …)`
  in `src/extension/api.ts:312`. `TaskAborted` from `src/core/task/TaskLifecycle.ts:530`.
  → An orchestrator can `Promise.all` children and capture each result.

### The one real constraint

`ClineProvider.clineStack: Task[]` (`src/core/webview/ClineProvider.ts:139`) is a strict **LIFO stack with a
single "current" task** (`getCurrentTask()` = top). Today's `new_task` runs **sequentially**:
`delegateParentAndOpenChild` flushes + marks the parent `delegated` (`awaitingChildId`), pushes the child, and
the single webview (`postStateToWebview`) renders only the top task. Subtasks are intentionally one-at-a-time
(`src/core/task/TaskSubtasks.ts:62`).

**Verdict:** Parallel subagents are feasible. The work is _not_ in the model/cwd/worktree layers (already there)
— it is introducing a **background task registry** that runs Tasks off the single-current-task stack, plus a
**multiplexed progress UI**. Worktrees give us free file/diff/terminal/checkpoint isolation, sidestepping the
hardest correctness problems.

## Design

### Track A — Orchestrator: headless subagents in worktrees (primary)

A new orchestrator tool fans out N children that each run **headless** (not the stack's "current" task) in their
**own git worktree**, then aggregates results back into the parent's next turn.

**A1. Thread `workspacePath` into task creation.**
Add `workspacePath?: string` to `CreateTaskOptions` (`packages/types/src/task.ts:91`) and pass it through
`ClineProvider.createTask` (`src/core/webview/ClineProvider.ts:2965`) into `new Task({...})`
(`ClineProvider.ts:3028`). The Task constructor already honors it. Crucially, **do not** route child creation
through the parent (which forces `parentTask.workspacePath`); spawn each subagent as its own root-ish task
carrying `parentTaskId` for lineage but an explicit `workspacePath`.

**A2. Background task registry (the core change).**
Add to `ClineProvider`: `private backgroundTasks = new Map<string, Task>()`. Background tasks:

- are created with `startTask: true` and run their normal `TaskApiLoop`,
- are **never** pushed onto `clineStack`, so `getCurrentTask()` / `postStateToWebview` (the live chat) stay
  bound to the orchestrator,
- are auto-approval only (no interactive `ask`): set their mode/config so they don't block on user input; if a
  child raises an interactive ask, surface it as a failure result rather than hanging (respects design-for-weak-models
    - headless constraints).

**A3. New fan-out tool** (e.g. `run_parallel_tasks`), built on `src/core/tools/BaseTool.ts` like
`src/core/tools/NewTaskTool.ts`. Schema kept dead-simple for weak models — one array of subtasks:

```
run_parallel_tasks(subtasks: [{ mode, message, todos? }], maxConcurrency?)
```

Execution:

1. For each subtask, `worktreeService.createWorktree(cwd, …)` (`packages/core/src/worktree/worktree-service.ts:98`)
   off the current branch (deterministic branch/folder name — derive from parent taskId + index, no `Math.random`
   reliance for reproducibility).
2. `provider.createBackgroundTask(message, { mode, workspacePath: worktreePath, parentTaskId, initialTodos })`.
3. Await completion per child: `Promise.all` over a helper that resolves on `TaskCompleted` (capturing the
   attempt_completion `lastMessage`) and rejects/marks-failed on `TaskAborted`.
4. Cap concurrency with a semaphore (`p-limit` or a tiny inline limiter) — default e.g. 3, overridable via
   `maxConcurrency` and a VSCode setting.
5. `pushToolResult` a single, clearly-delimited aggregate: per-subagent heading, worktree path, branch,
   success/fail, and result text. Explicit delimiters so weak orchestrator models can parse it.

**A4. Isolation & safety (mostly free via worktrees).**

- Files/diffs/terminals/checkpoints all key off `this.cwd` → per-worktree, no cross-talk.
  `ShadowCheckpointService` is per-workspace, so each worktree gets its own shadow git.
- **Rate limiter caveat:** `getLastGlobalApiRequestTime()` is process-global; with `rateLimitSeconds > 0` it will
  mis-serialize parallel children. Make the rate-limit tracking per-apiConfig (or document that parallelism
  assumes `rateLimitSeconds = 0`). Flag explicitly in the tool's preconditions.
- Result merge is **not** automatic: leave worktrees/branches intact for review by default; Phase 5 adds opt-in
  merge/cleanup.

**A5. Subagents progress UI.**
The live chat stays on the orchestrator. Add a "Subagents" panel (collapsible section in the parent chat, or a
new webview tab) driven by existing per-task events — `TaskActive`/`TaskIdle`/`TaskCompleted`/`TaskTokenUsageUpdated`
(`src/core/task/TaskTokenTracking.ts:100`). MVP shows, per child: mode, worktree/branch, status, token/cost, and
final result; "open in new window" jumps into that worktree (Track B). Webview already has tab infra (`switchTab`,
`webview-ui/src/components/chat/ChatView.tsx:1784`) to extend.

### Track B — Window-per-agent dispatch (heavyweight / independent tasks)

Lean on the existing worktree+new-window machinery; add one-click "send this work to a fresh worktree window":

- New command / context action: create worktree (reuse `handleCreateWorktree`), stash a **pending task prompt**
  in `globalState` alongside `worktreeAutoOpenPath`, then `openFolder(forceNewWindow:true)`.
- In `src/extension.ts` worktree auto-open path (`extension.ts:82-103`), after focusing the sidebar, if a pending
  prompt exists, auto-`createTask` with it and clear the key.
- Net new code is small; it reuses `handleSwitchWorktree`'s pattern.

## Files to create / modify

- `packages/types/src/task.ts` — add `workspacePath?` to `CreateTaskOptions`.
- `src/core/webview/ClineProvider.ts` — `backgroundTasks` map; `createBackgroundTask()`; `awaitTaskCompletion()`
  helper; thread `workspacePath` in `createTask`; expose background status for the webview.
- `src/core/tools/RunParallelTasksTool.ts` (new) + register in the tool registry + native-tool prompt under
  `src/core/prompts/tools/` (mirror `src/core/prompts/tools/native-tools/new_task.ts`).
- `src/core/webview/worktree/handlers.ts` + `src/extension.ts` — Track B pending-prompt dispatch.
- `webview-ui/src/components/chat/` — Subagents panel/tab.
- Tests beside each (mirror `src/core/tools/__tests__/newTaskTool.spec.ts`,
  `src/core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts`).

## Phasing

0. This plan committed; branch `feature/parallel-subagents` off `main` (one-branch-per-feature; Track B can stack
   on it since files overlap).
1. Thread `workspacePath`; `backgroundTasks` registry; spawn+await **one** headless child in a worktree, result
   via `tool_result` (no UI). Proves the model end-to-end.
2. Fan-out tool + concurrency cap + aggregated result formatting.
3. Subagents progress UI.
4. Track B window dispatch.
5. Opt-in worktree merge/cleanup ergonomics.

Phases 1–2 deliver the core "decomposition speed" win; 3–5 are ergonomics.

## Verification

- **Unit:** new tool (validation, worktree creation mocked, aggregation), `createBackgroundTask`/registry
  (children excluded from `clineStack`, `getCurrentTask` unchanged), `workspacePath` plumb-through.
- **Integration (headless):** drive via the existing `API` (`src/extension/api.ts`) in a temp git repo — spawn
  2–3 parallel subagents into temp worktrees, assert each runs in its own dir, all `TaskCompleted` fire, results
  aggregate, worktrees isolated.
- **Manual (Extension Dev Host):** run an orchestrator task that fans out edits to 3 modules; confirm concurrent
  progress in the Subagents panel, distinct branches/worktrees, orchestrator chat stays responsive, and Track B
  "open in new window" lands in the right worktree.
- Confirm behavior with `rateLimitSeconds = 0` (parallel) vs `> 0` (documented serialization).

## Risks

- **UI multiplexing** is the largest surface; mitigated by starting headless (Phase 1–2 ship without UI).
- **Interactive asks inside headless children** must fail-fast, not hang — covered in A2.
- **Global rate limiter** must be made per-config or documented (A4).
- **Worktree cleanup/disk** — leave intact by default; cleanup is explicit (Phase 5).
