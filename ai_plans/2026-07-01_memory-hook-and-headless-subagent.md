# Memory background writers: fix the hook, then a reusable headless sub-agent

**Date:** 2026-07-01
**Branch:** `feature/memory-subtask-runner-wiring` (off `main`)
**Status:** DONE. Phase 1 (hook) + Phase 2 (slices 1–3) implemented, tested, committed.
Commits: `056eb3211` (hook), `cd20a6a3c` (slice 1 primitive), `eceec7e64` (slice 2 memory
writes ON), `9e95492ab` (slice 3 run_parallel_tasks).

## Problem (proven)

The auto-memory system ([`src/core/memory/`](../src/core/memory/)) never writes any files. Evidence:

- The on-disk memory tree for this extension (`qub-it.tumble-code`) contains **zero** `.md`
  files — only a stray `.consolidate-lock` under `.../voicebot-server/memory/`. That lock is
  the smoking gun: `autoDream` passed its gates, acquired the lock and ran — but produced no
  output.
- **Root cause A — the runner is a no-op.** [`TaskLifecycle.triggerMemoryBackgroundWriters()`](../src/core/task/TaskLifecycle.ts)
  reads `provider.memorySubTaskRunner` and falls back to `noopSubTaskRunner` when it is
  absent. `memorySubTaskRunner` is **never assigned anywhere** (grep: only the read site
  exists). So both `executeExtractMemories` and `executeAutoDream` spawn a runner that returns
  `{ writtenPaths: [] }` and does nothing. The code comment admits it: _"until that wiring is
  present it's a no-op ... safe to ship ahead of the spawn implementation."_
- **Root cause B — the trigger fires at the wrong time.** `triggerMemoryBackgroundWriters()` is
  only called from `abortTask()` ([TaskLifecycle.ts:553](../src/core/task/TaskLifecycle.ts)).
  Normal completion does **not** go through `abortTask` — it emits `TaskCompleted` from
  [`AttemptCompletionTool`](../src/core/tools/AttemptCompletionTool.ts) and the task stays
  alive. The task is later torn down via `removeClineFromStack → abortTask(true)` (abandoned),
  and the abandoned branch **skips** the writers. Net: for a task that completes normally, the
  writers never run.
- **Gap C — the sub-agent gets no conversation to analyze.** `ExtractionContext.messages` is
  used only for mutual-exclusion detection (`hasMemoryWritesSince`). The sub-agent receives only
  `systemPrompt` + `userPrompt`; the prompt says _"analyze the ~N messages above"_ but no
  messages are ever provided.
- **Constraint D — Roo's write tools are Task- and UI-coupled.** `WriteToFileTool` /
  `EditFileTool` drive `task.diffViewProvider` (opens editor tabs), `task.rooIgnoreController`,
  `task.fileContextTracker`. A headless background writer that reuses them must run inside a real
  `Task` and must suppress the diff-view UI for memory writes.
- **Constraint E — native tool calls.** Roo drives tools via `NativeToolCallParser` +
  `metadata.tools`, not XML. Any sub-agent that reuses Roo's tool loop inherits this for free;
  a hand-rolled loop would have to reimplement it.

## Decision

Two phases, sequenced per the owner's direction ("najpierw dorób hook, a później do tego
headless task; zaplanuj headless task tak, abyśmy mogli reużyć tego mechanizmu dla podagentów").

- **Phase 1 — the hook (now).** Make the trigger fire at the right moment and hand the sub-agent
  real content. After Phase 1 the seam is correct and unit-tested, but writes stay off until the
  engine lands (runner still defaults to no-op). This is the explicit sequencing.
- **Phase 2 — the reusable headless sub-agent (planned).** Build the **background task registry**
  primitive from [`ai_plans/2026-06-27_parallel-subagents-worktrees.md`](2026-06-27_parallel-subagents-worktrees.md)
  (A1/A2): `ClineProvider.createBackgroundTask()` + `awaitTaskCompletion()`, headless (off
  `clineStack`), auto-approval sandbox, no diff-view UI. Memory's `memorySubTaskRunner` becomes
  the **first consumer** of this primitive; the future `run_parallel_tasks` fan-out tool is the
  second. One mechanism, two clients.

Rationale for not hand-rolling a memory-only loop: it would duplicate native-tool-call streaming
(Constraint E), can't reuse the Task-coupled write tools (Constraint D), and would be thrown away
once the parallel-subagents primitive lands. Building the shared primitive once is the owner's
stated goal.

---

## Phase 1 — The hook (implement now)

### P1.1 Fire the writers on normal completion

- `Task` subscribes to its own `RooCodeEventName.TaskCompleted` and calls a public
  `lifecycle.triggerMemoryBackgroundWriters()` (rename the method from `private` → public, or add
  a thin public `onTaskCompleted()` wrapper). Register the listener in `startTask`, remove it in
  `dispose()`.
- Keep the existing non-abandoned `abortTask()` call for user-cancelled / errored tasks (durable
  signal can still exist there). The abandoned branch stays skipped — completion already fired the
  writers before the task is abandoned/replaced.
- Idempotency is already handled: `executeExtractMemories` early-returns when
  `newMessageCount <= 0`, and the in-flight `Set` + cursor prevent double work if both
  `TaskCompleted` and a later `abortTask` fire.

### P1.2 Feed the recent conversation into the extraction prompt (closes Gap C)

- Render a **bounded transcript** of the last N entries of `apiConversationHistory` (Anthropic
  format: user/assistant, tool_use/tool_result). Bounds: last ~30 messages, per-message char cap
  (~2 KB), tool-result truncation — keep it cheap and weak-model-friendly.
- Extend `buildExtractionPrompt(newMessageCount, existingManifest, transcript)` to inline the
  transcript under a clearly delimited `## Recent conversation` heading, replacing the dangling
  "messages above" reference. No `SubTaskRunner` interface change — the transcript rides inside
  `userPrompt`, so the Phase 2 engine (and the parallel-subagent tool) consume a self-contained
  prompt string.
- Renderer lives in a new `src/core/memory/transcript.ts` (pure, unit-testable): takes
  `ApiMessage[]` + bounds, returns a string.

### P1.3 Keep the injection seam explicit

- Leave `provider.memorySubTaskRunner ?? noopSubTaskRunner` in place but add a `// Phase 2:` note
  pointing at `createBackgroundTask`. This is the single line Phase 2 flips on.

### P1.4 Tests (Phase 1)

- `transcript.spec.ts`: bounding, truncation, ordering, empty history.
- Extend `extractMemories.spec.ts`: prompt now contains the rendered transcript; still respects
  mutual-exclusion + cursor; `newMessageCount <= 0` early-return.
- A `TaskLifecycle`/`Task` test (or a focused unit) asserting `TaskCompleted` triggers the writers
  (runner stub invoked) and that abandoned-abort does not double-fire.

### Phase 1 exit criteria

On task completion, `executeExtractMemories` is invoked with a prompt that contains the recent
transcript and the existing-memory manifest; the (stub) runner is called exactly once per
completion; all new/updated tests green; `noopSubTaskRunner` still means no files are written yet.

---

## Phase 2 — Reusable headless sub-agent (APPROVED: build on this branch, primitive + fan-out tool)

Aligns with [`2026-06-27_parallel-subagents-worktrees.md`](2026-06-27_parallel-subagents-worktrees.md)
A1/A2 so the same primitive serves memory **and** parallel subagents.

### Research-grounded seams (verified in tree)

- **No per-Task auto-approval exists.** `TaskAskSay.ask()` (src/core/task/TaskAskSay.ts:81-84) calls
  `checkAutoApproval({state,...})` reading **global** provider state, then `approveAsk()` sets
  `askResponse` to unblock the `pWaitFor`. → Add an **optional per-Task predicate**
  `autoApprovalOverride?(ask, text): "approve"|"deny"|undefined` checked at the top of `ask()`
  before the global check. `undefined` → existing behavior (zero foreground change).
- **The loop.** `initiateTaskLoop` (outer `while(!abort)`) → `recursivelyMakeClineRequests`
  (inner `while(stack.length)`; each pop = one assistant turn). → Add optional `maxAgentTurns`;
  increment a per-Task counter at the top of the inner loop; when exceeded, abort the task cleanly
  (sets `abort`, returns), so the loop unwinds normally. Default undefined → no cap.
- **Both write paths open an editor.** `WriteToFileTool` uses either `diffViewProvider.saveDirectly`
  or `open`+`saveChanges`; **both** call `vscode.window.showTextDocument` (DiffViewProvider.ts:982).
  → Add a per-Task `silentWrites`/background flag; `saveDirectly` skips `showTextDocument` and just
  writes to disk when set (guarded so foreground is unchanged). Memory writes become invisible.
- **Sandbox = restrictive mode + existing carve-out.** `validateToolUse` already allows writes to
  `isAutoMemPath` regardless of a mode's edit `fileRegex` (validateToolUse.ts:221). → Run the memory
  background task in a built-in **`memory-writer`** mode whose edit group `fileRegex` matches nothing
  (`$^`): normal writes throw `FileRestrictionError`, memory writes pass via the carve-out. Read
  tools unrestricted. This is the airtight sandbox; the auto-approval predicate can then safely
  approve all asks.
- **writtenPaths.** `fileContextTracker.getAndClearCheckpointPossibleFile()`
  (FileContextTracker.ts:262) returns the in-memory set of Roo-edited paths; resolve against
  `task.cwd`, filter to `isAutoMemPath`. (Memory filters `MEMORY.md` from the "Saved N" count.)
- **Background task = new Task without `addClineToStack`.** `taskCreationCallback`/`onCreated`
  (ClineProvider.ts:241) only wires events — the stack push is the separate `addClineToStack`
  (ClineProvider.ts:474/1138). So a background task is `new Task({..., onCreated})` **without**
  the stack push; `getCurrentTask()`/`postStateToWebview` stay on the foreground task.

### Build slices (each self-contained, tested, committed)

- **Slice 1 — reusable core (no foreground behavior change):** `workspacePath` on
  `CreateTaskOptions`; per-Task `autoApprovalOverride` seam in `TaskAskSay`; per-Task `maxAgentTurns`
  in `TaskApiLoop`; `ClineProvider.backgroundTasks` + `createBackgroundTask()` +
  `awaitTaskCompletion()`. Tests.
- **Slice 2 — memory consumer (delivers the original goal: memory writes):** `memory-writer`
  sandbox mode; `silentWrites` diff-view suppression; `writtenPaths` capture; wire
  `ClineProvider.memorySubTaskRunner` → `createBackgroundTask`+`awaitTaskCompletion`. Flip the
  `noopSubTaskRunner` fallback. Tests.
- **Slice 3 — fan-out tool:** `run_parallel_tasks` ToolName + registrations (tool.ts, tools.ts
  groups/ALWAYS_AVAILABLE, native-tools prompt, presentAssistantMessage dispatch);
  `RunParallelTasksTool` (worktree per subtask via `worktreeService.createWorktree`, concurrency
  cap, aggregated `tool_result`). Tests.

### Original A1/A2 mapping

### P2.1 `workspacePath` in `CreateTaskOptions` (A1)

Already partly present (`TaskOptions.workspacePath`); confirm it is on `CreateTaskOptions`
(`packages/types/src/task.ts`) and threaded through `ClineProvider.createTask` → `new Task`.

### P2.2 Background task registry on `ClineProvider` (A2) — the reusable core

- `private backgroundTasks = new Map<string, Task>()`.
- `createBackgroundTask(text, opts): Task` — creates a Task with `startTask: true`, **never**
  pushed onto `clineStack` (so `getCurrentTask()` / `postStateToWebview` stay on the foreground
  task), `parentTaskId` for lineage, explicit `workspacePath` (defaults to parent cwd for memory).
- `awaitTaskCompletion(task, { maxTurns, signal }): Promise<{ lastMessage, writtenPaths }>` —
  resolves on `TaskCompleted`, rejects/marks-failed on `TaskAborted`, enforces a turn cap.
- **Headless controls** (needed by both memory and parallel subagents):
    - Auto-approval: an injectable per-task tool-approval predicate so no interactive `ask` blocks
      a background task; an interactive ask surfaces as a failure, never hangs (A2).
    - Sandbox predicate for memory: allow `read_file`/`list_files`/`search_files` (+ read-only
      `execute_command`) anywhere; allow `write_to_file`/`edit_file`/`apply_diff` **only** inside
      `isAutoMemPath` (the `validateToolUse` carve-out already exists — extend to the auto-approval
      layer so writes elsewhere are denied, not just regex-carved).
    - Diff-view suppression for memory writes: memory files live outside the workspace; drive
      `diffViewProvider.saveDirectly` (no editor tab) or bypass the diff-view path for
      `isAutoMemPath` writes so background writing is invisible.
    - `maxTurns` enforcement (Roo has no native turn cap) — abort the background task after N
      assistant turns.
    - `writtenPaths` capture: collect successful memory writes via `fileContextTracker` events or a
      write-hook, filter to `isAutoMemPath`, return them (memory filters out `MEMORY.md` for the
      "Saved N" count).

### P2.3 Wire memory to the primitive

- Implement `ClineProvider.memorySubTaskRunner` (or inject from the lifecycle using the task's own
  `api` handler) as a `SubTaskRunner` that calls `createBackgroundTask` + `awaitTaskCompletion`
  with the memory sandbox, then returns `{ writtenPaths }`. The extraction/dream prompts already
  reference Roo tool names, so a real Task "just works" once sandboxed.

### P2.4 Generality check (parallel subagents reuse)

`createBackgroundTask` / `awaitTaskCompletion` / the auto-approval predicate must be
task-agnostic. Memory passes a memory sandbox + memory prompt; `run_parallel_tasks` (future) passes
a worktree `workspacePath` + a normal mode. No memory-specific logic leaks into the registry.

### P2.5 Tests (Phase 2)

- Registry: background tasks excluded from `clineStack`; `getCurrentTask()` unchanged.
- Sandbox: write outside `isAutoMemPath` denied; inside allowed; read anywhere allowed.
- `awaitTaskCompletion`: resolves on completion, fails on abort, enforces `maxTurns`.
- End-to-end (mocked handler): a scripted completion writes a memory file and `writtenPaths`
  reflects it; `MEMORY.md`-only touches don't inflate the count.

### Phase 2 exit criteria

After a real task completes, a headless background sub-agent runs invisibly (no editor tabs, not on
the stack), writes topic files + `MEMORY.md` under the per-workspace memory dir, and the "Saved N
memories" log fires; `autoDream` consolidates after its gates; killing a dream rolls back the lock.

---

## Files

**Phase 1 (now)**

- `src/core/memory/transcript.ts` (new) — bounded `ApiMessage[]` → transcript renderer.
- `src/core/memory/extractMemories.ts` — `buildExtractionPrompt(..., transcript)`; thread transcript.
- `src/core/task/TaskLifecycle.ts` — make trigger public; build + pass transcript.
- `src/core/task/Task.ts` — subscribe to own `TaskCompleted` → trigger; unsubscribe on dispose.
- Tests: `src/core/memory/__tests__/transcript.spec.ts`, extend `extractMemories.spec.ts`.

**Phase 2 (after approval)**

- `packages/types/src/task.ts` — confirm `workspacePath?` on `CreateTaskOptions`.
- `src/core/webview/ClineProvider.ts` — `backgroundTasks`, `createBackgroundTask`,
  `awaitTaskCompletion`, `memorySubTaskRunner`, auto-approval predicate plumbing.
- `src/core/task/*` — headless auto-approval hook, `maxTurns`, diff-view suppression for
  `isAutoMemPath`, `writtenPaths` capture.
- Tests beside each.

## Risks

- **Double-fire** of writers (TaskCompleted + abortTask): mitigated by cursor + `newMessageCount<=0`
  early return + in-flight `Set`.
- **Transcript size / cost:** bounded message count + per-message truncation.
- **Phase 2 headless asks hanging:** auto-approval predicate must fail-fast on interactive asks
  (A2), never block.
- **Diff-view tabs for memory writes:** must use `saveDirectly`/bypass for `isAutoMemPath`.
- **Global rate limiter** (`rateLimitSeconds > 0`) serializes parallel children — document; memory
  runs one child so unaffected.
