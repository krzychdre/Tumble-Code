# Background-task hardening: fix the two consumers of the headless primitive

**Date:** 2026-07-11
**Base branch:** `fix/memory-writers-skip-user-cancel` (stacked; one branch per slice)
**Status:** DONE. All 7 slices implemented, reviewed, tested, committed:

| Slice     | Branch                                        | Commit        |
| --------- | --------------------------------------------- | ------------- |
| 1 (F1+F7) | `fix/memory-extraction-cursor-per-task`       | `1721393fd`   |
| 2 (F2)    | `fix/parallel-tasks-cancel-propagation`       | `7d72baed1`   |
| 3 (F3)    | `fix/parallel-tasks-approval-policy`          | `edda8b4e6`   |
| 4 (F4+F5) | `fix/background-tasks-history-and-visibility` | `c2a2d3c89`   |
| 5 (F6)    | `feat/memory-writer-api-profile`              | `b6dd156b5`   |
| 6 (F8)    | `feat/parallel-worktree-cleanup`              | `52378e528`   |
| 7         | `refactor/background-task-loose-ends`         | (this commit) |

Review-round corrections worth noting: slice 1 — controller registration moved after the
run IIFE (leak on scan failure); slice 3 — protected-file writes inside the worktree
delegate to `checkAutoApproval` instead of short-circuiting (a child must not rewrite its
own `.rooignore` guardrails un-asked); slice 4 — task-dir cleanup sequenced after dispose
settles (dispose's `saveClineMessages` could resurrect the deleted directory); slice 5 —
Radix rejects `SelectItem value=""`, sentinel `"-"` used per PromptsSettings precedent;
slice 6 — unparseable `rev-list` output errs toward keeping (NaN must not read as 0).

**Predecessor:** [`2026-07-01_memory-hook-and-headless-subagent.md`](2026-07-01_memory-hook-and-headless-subagent.md)

## Problem (proven, per-finding evidence)

An analysis of the Phase 2 headless background-task system found the **primitive sound**
(`createBackgroundTask`/`awaitTaskCompletion`, stack isolation, `autoApprovalOverride` seam,
`maxAgentTurns` bounding) but both consumers defective:

- **F1 — extraction cursor is module-global, compared against per-task lengths.**
  `lastMemoryMessageCursor` (extractMemories.ts:80) is a single module scalar. Task A completes
  with 60 messages → cursor = 60. Task B completes with 25 messages →
  `newMessageCount = 25 − 60 ≤ 0` → extraction **silently skips** (extractMemories.ts:144-145).
  Within one extension session only tasks longer than the longest prior task ever extract.
  The comment "mirrors the upstream closure" reveals the port bug: upstream's closure was
  per-task; the module scalar is cross-task.
- **F2 — cancelling the parent orphans parallel children.** `RunParallelTasksTool` calls
  `provider.awaitTaskCompletion(child)` with **no signal** (RunParallelTasksTool.ts:199).
  Parent abort (user Stop) leaves up to N children running invisibly — up to 50 turns each,
  auto-approving everything, with no UI to see or stop them. Same bug class as the one fixed
  on the base branch for memory writers, one layer up.
- **F3 — fan-out subagents blanket-approve everything.** `autoApprovalOverride: () => "approve"`
  (RunParallelTasksTool.ts:197) short-circuits **before** `checkAutoApproval`
  (TaskAskSay.ts:93-99), so the user's command allow/deny lists, browser/MCP toggles, and
  protected-file guards are all bypassed. The worktree confines _file edits_ but nothing
  confines `execute_command`. One upfront approval of subtask descriptions is not informed
  consent for unsupervised arbitrary command execution.
- **F4 — background tasks pollute history and lose their sandbox on resume.**
  `TaskHistory.saveClineMessages → updateProviderTaskHistory → provider.updateTaskHistory`
  (TaskHistory.ts:458-459, 505-507) has no `isBackground` guard, so every memory extraction
  and every parallel subtask appears in the history panel. Clicking one rehydrates it as a
  **foreground, unsandboxed** task: `isBackground`, `autoApprovalOverride`, `silentWrites`,
  `maxAgentTurns` are constructor options, not persisted in `HistoryItem`.
- **F5 — memory writes are invisible to the user.** Success surfaces only as `console.log`
  (TaskLifecycle.ts:632). The original no-op runner went unnoticed for weeks for exactly this
  reason; F1 would be equally invisible.
- **F6 — no cheap-model routing for background writers.** The extraction child runs with the
  foreground model and the full code-mode system prompt after every completed task. The
  extraction prompts are already weak-model-friendly by design; there is no setting to route
  them to a cheap/local profile.
- **F7 — dead abort plumbing in extraction.** The `AbortController` in `executeExtractMemories`
  (extractMemories.ts:154) is created, passed as `signal`, and never aborted by anyone.
  `drainPendingExtraction`'s timeout abandons in-flight work without cancelling it.
- **F8 — worktrees and branches accumulate forever.** `~/.roo/worktrees/<tag>` +
  `worktree/parallel-*` branches are never removed, even when a subtask failed or produced
  zero changes. `WorktreeService.deleteWorktree` exists (worktree-service.ts:144) but is unused
  by the tool; there is no branch-deletion helper.

## Decision

Seven stacked slices, one branch each, ordered by value-to-risk. Each slice is
self-contained: implemented (by a sonnet subagent), reviewed against this plan, tested,
committed before the next branch is cut. Design constraints throughout:

- **Low cognitive complexity** — small pure helpers, early returns, no cleverness; each
  policy decision readable as prose.
- **Weak-model safety** — nothing here changes prompts, but any new tool-facing text must
  stay explicit and literal.
- **Mode/rehydration safety** — never persist behavior in state that a resume can
  misinterpret; prefer "not resumable at all" (F4) over "resumable with different semantics".
- **Fail-safe approvals** — a headless task must never block on a webview response; every
  policy must always decide.

---

## Slice 1 — branch `fix/memory-extraction-cursor-per-task` (F1 + F7)

### Design

- Add `taskId: string` to `ExtractionContext`. Replace the module scalar with
  `const cursors = new Map<string, number>()` keyed by taskId (default 0). The
  double-fire idempotency (TaskCompleted → later non-abandoned abort of the same task)
  is preserved because both fires share the taskId.
- Bound the map: after a successful run, the entry has done its job **only** for the
  double-fire window; evict oldest entries above a small cap (e.g. 64) using Map insertion
  order. Simple `if (cursors.size > MAX) delete first key` — no LRU machinery.
- `hasMemoryWritesSince` keeps its signature (cursor passed in by caller).
- **F7:** track in-flight `AbortController`s in a module `Set` parallel to
  `inFlightExtractions`. `drainPendingExtraction(timeoutMs)`: when the soft timeout fires
  with work still pending, `abort()` the remaining controllers so shutdown doesn't orphan
  live LLM streams. `resetExtractionState()` clears both. The controller/`signal` plumbing
  stops being dead code.
- `TaskLifecycle.triggerMemoryBackgroundWriters` passes `taskId: this.access.taskId`.

### Tests (`extractMemories.spec.ts`)

- Long task (cursor 60) then short task (25 messages) → **second task still extracts**.
- Same task double-fire → second call early-returns (cursor at length).
- Mutual-exclusion advance stays per-task.
- Drain timeout aborts in-flight controllers; normal completion does not.

## Slice 2 — branch `fix/parallel-tasks-cancel-propagation` (F2)

### Design

- In `RunParallelTasksTool.execute`, after approval: create one `AbortController` for the
  whole fan-out. Subscribe `parentTask.on(RooCodeEventName.TaskAborted, abort)`; also check
  `task.abort === true` up front (pre-aborted parent starts nothing). Unsubscribe in `finally`.
- Worker changes: before creating a worktree and before spawning the child, check
  `signal.aborted` → return `{ status: "failed", error: "cancelled by user" }` without side
  effects. Pass `{ signal }` to `awaitTaskCompletion` (which already aborts the child task
  on signal — verified at ClineProvider.ts:3138-3140, 3179-3182).
- `formatParallelResults` distinguishes cancelled results ("CANCELLED") from real failures.
- Keep the worker function small — extract per-subtask logic into a named private method or
  module function so `execute` reads as: validate → approve → guard → fan out → report.

### Tests (new `__tests__/RunParallelTasksTool.spec.ts` — also covers validate/format/concurrency helpers if not already)

- Parent emits TaskAborted mid-run → all pending/live children receive the signal;
  results marked cancelled; listener removed afterwards.
- Parent already aborted → no worktree created, no child spawned.
- Normal path unaffected (signal never fires).

## Slice 3 — branch `fix/parallel-tasks-approval-policy` (F3)

### Design

- **Extend the override seam to async + protection-aware.** `AutoApprovalOverride` becomes
  `(ask, text, isProtected?) => Decision | undefined | Promise<Decision | undefined>` where
  `Decision = "approve" | "deny"`. `TaskAskSay.ask` awaits it (line 93). Sync overrides
  (memorySandbox) remain structurally compatible; `undefined` still falls through to the
  normal global flow — zero foreground change.
- **New module `src/core/task/subagentApproval.ts`** exporting
  `buildSubagentApprovalPolicy({ getState, worktreePath })` used by `RunParallelTasksTool`
  instead of `() => "approve"`. Policy, in priority order (must ALWAYS decide — a headless
  child can never fall through to `undefined`, it would hang):
    1. Non-`tool`/`command`/`browser_action`/`use_mcp_server` asks (followup,
       completion_result, api_req_failed, resume…) → `"approve"` — autonomy, mirrors
       memorySandbox; retries stay bounded by `maxAgentTurns`.
    2. `tool` asks that are read-only actions (`isReadOnlyToolAction`) → `"approve"`.
    3. `tool` asks whose target path resolves **inside the child's worktree** → `"approve"`.
       This is the isolation contract the user approved at fan-out time: edits confined to a
       throwaway worktree. Path resolution mirrors memorySandbox (resolve against the
       worktree cwd, prefix containment check with separator-terminated prefix).
    4. Everything else (`command`, `browser_action`, `use_mcp_server`, writes outside the
       worktree, unparsable/path-less writes) → delegate to
       `checkAutoApproval({ state: await getState(), ask, text, isProtected })`:
       `approve → "approve"`; `deny`/`ask`/`timeout` → `"deny"` (fail-fast; a subagent has no
       user to ask and must not wait on a timeout designed for a visible countdown).
- Net effect: subagents inherit exactly the user's configured command allow/deny lists and
  browser/MCP toggles; anything the user would have been asked about is denied instead of
  silently approved.
- Factor the shared "parse tool ask JSON, read-only check, path containment" bits between
  `memorySandbox.ts` and `subagentApproval.ts` into a small shared helper **only if it
  reduces total complexity** — otherwise leave the two policies independently readable
  (they intentionally differ: memory denies commands outright).

### Tests (`subagentApproval.spec.ts` + TaskAskSay async-override test)

- Command on the allowlist → approve; denylisted/unlisted command → deny (mock state).
- Write inside worktree → approve without consulting global state; outside → global path.
- `ask`/`timeout` decisions map to deny. Non-tool asks approve.
- `TaskAskSay` awaits an async override; sync override and `undefined` fall-through
  behavior unchanged.

## Slice 4 — branch `fix/background-tasks-history-and-visibility` (F4 + F5)

### Design

- **History:** `TaskHistory.saveClineMessages` skips `updateProviderTaskHistory` when the
  task is background (expose `isBackground` on the `TaskHistory` access surface). Messages
  are still written to the per-task directory while running (crash debuggability).
- **Disk lifecycle:** on terminal state in `awaitTaskCompletion`: **completed** background
  tasks get their task directory deleted (nothing references it — no history item);
  **aborted/failed** ones keep their directory for post-mortem inspection. Use the existing
  task-storage deletion helper (locate the one `deleteTaskWithId` uses; do not hand-roll
  `rm -rf`). Best-effort `try/catch` — cleanup failure must never fail the await.
- **Visibility (F5):** in `TaskLifecycle.triggerMemoryBackgroundWriters`, `onSaved` calls a
  new small provider hook that shows a **non-blocking** toast
  `vscode.window.showInformationMessage(t("common:info.memory_saved", { count }))` (add the
  i18n key to `src/i18n` en locale; follow existing `common:info.*` precedent at
  importExport.ts:397). Keep the console.log for logs. Same for autoDream's `onImproved`
  (`memory_consolidated`). No new webview messages — the toast is the whole feature.
- Explicitly **not** persisting an `isBackground` flag into `HistoryItem`: a background task
  must not be resumable at all, per the rehydration-safety constraint.

### Tests

- `TaskHistory` spec: background task → no `updateTaskHistory` call; foreground unchanged.
- `backgroundTask.spec.ts`: completed → task dir removed; aborted → dir retained.
- Lifecycle spec: `onSaved(2, …)` → provider toast hook invoked with count.

## Slice 5 — branch `feat/memory-writer-api-profile` (F6)

### Design

- New global setting `memoryWriterApiConfigId?: string` (packages/types global-settings +
  ContextProxy pass-through, mirroring `autoDreamEnabled`'s wiring from commit eceec7e64).
- `createBackgroundTask` gains optional `apiConfiguration?: ProviderSettings` which, when
  provided, replaces the `getState()` one.
- `memorySubTaskRunner`: read `memoryWriterApiConfigId`; when set, resolve via
  `providerSettingsManager.getProfile({ id })` in a `try/catch` → on any failure fall back
  to the foreground configuration (a stale profile id must never break memory writes; log
  the fallback).
- `MemorySettings.tsx`: profile dropdown fed by `listApiConfigMeta` (the webview already
  receives it in state), default option "Use current profile" (empty value). i18n keys in
  `webview-ui` en locale following the existing MemorySettings keys.
- `run_parallel_tasks` deliberately **keeps** the foreground model (subtasks are real work);
  only memory writers get the cheap-model routing.

### Tests

- Provider spec: runner uses resolved profile when id set; falls back when resolution
  throws or id unset. MemorySettings.spec: renders dropdown, persists selection.

## Slice 6 — branch `feat/parallel-worktree-cleanup` (F8)

### Design

- Extend `WorktreeService` with `hasChanges(worktreePath)` (porcelain status non-empty) and
  `deleteBranch(cwd, branch, { force })` — thin wrappers beside `deleteWorktree`, same
  error-shape (`WorktreeResult`).
- In the subtask worker's completion path: if the child **failed/was cancelled** or the
  worktree has **no uncommitted changes and no commits on its branch** (`git rev-list
      <base>..<branch>` empty — add `branchHasCommits` helper or fold into `hasChanges`), then
      `deleteWorktree(force)` + `deleteBranch`; result line says "cleaned up (no changes)".
      Worktrees **with** changes are always kept — never delete user-reviewable work.
- Best-effort: cleanup errors are appended to the result text, never thrown.
- `formatParallelResults` shows kept-vs-cleaned per subtask so the parent model can tell
  the user exactly where review is needed.

### Tests

- Service: `hasChanges`/`deleteBranch`/commit-detection against a temp git repo (follow the
  existing worktree-service spec patterns if present; else mock exec).
- Tool spec: failed child with clean worktree → cleaned; completed child with changes → kept.

## Slice 7 — branch `refactor/background-task-loose-ends`

- Re-read the full stack diff (`git diff fix/memory-writers-skip-user-cancel..HEAD`) with
  fresh eyes; extract duplicated helpers, flatten any nesting introduced under review
  pressure, fix naming drift.
- Verify every docstring still tells the truth (ClineProvider background-task docs,
  memorySandbox policy comment, this plan's status lines).
- Update this plan + the predecessor plan status.
- Full gate: workspace typecheck + lint + the complete test files touched anywhere in the
  stack, run green in one pass.

---

## Execution protocol (autonomous)

1. Each slice: `git checkout -b <branch>` **before the first edit** (stacked on the
   previous slice's branch).
2. Implementation delegated to a **sonnet** general-purpose subagent with the slice spec
   (files, design, tests, "run targeted vitest + tsc, no commits, report back").
3. Reviewer (me) reads the **full diff**, re-runs tests + typecheck + lint independently,
   checks against this plan's design bullets, and sends corrections back to the same agent
   until clean. Trivial nits may be fixed directly by the reviewer.
4. Conventional commit per slice; plan status updated at the end.

Verification commands (from `src/`): `npx vitest run <spec paths>`;
`cd .. && pnpm check-types` (or the repo's equivalent script — confirm once in slice 1);
`npx eslint <changed files>`.

## Risks

- **Async override (slice 3) touches the foreground ask path.** Mitigation: `undefined`
  fall-through covered by an explicit regression test; the await of a sync value is a no-op.
- **History skip (slice 4) may have hidden consumers** (cloud sync, token telemetry keyed
  off history items). Reviewer must grep for `updateTaskHistory` callers and
  `taskHistoryStore` readers before approving.
- **Task-dir deletion (slice 4)** must reuse the exact storage-path helper the delete-task
  flow uses — a wrong path here is destructive. Reviewer verifies the resolved path in the
  test.
- **Worktree cleanup (slice 6)** is destructive by design; the "keep anything with changes"
  rule is the invariant every test must pin.
- **Stacked-branch drift:** no rebasing; each branch builds on the previous one's HEAD.
