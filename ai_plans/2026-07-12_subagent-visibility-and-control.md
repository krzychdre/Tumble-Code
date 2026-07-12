# Subagent visibility, interaction, and configuration

**Date:** 2026-07-12
**Base:** `fix/delegated-child-return-after-cancel` (a9474a665, tip of the background-task hardening stack)
**Status:** IN PROGRESS

## Problem

When the orchestrator fans out work via `run_parallel_tasks` (e.g. 4 ask-mode
subtasks), the children run as headless background tasks (`ClineProvider.
createBackgroundTask`) that are deliberately invisible: never on `clineStack`,
never in the webview state, asks auto-decided by `buildSubagentApprovalPolicy`.
The user cannot tell whether they are running, stuck, or done, and cannot
answer a child's question. Parallelism must stay; observability and control
must be added.

User asks (verbatim intent):

1. See what is happening in each subagent, live.
2. Interact with subagent sessions (answer questions, send guidance, cancel).
3. Configure how many tasks may run in parallel (settings UI).
4. Choose the model that handles specific tasks.

## Evidence (traced, working tree at a9474a665)

- Fan-out: `src/core/tools/RunParallelTasksTool.ts` — worktree per subtask,
  `createBackgroundTask` + `awaitTaskCompletion`, pool via `runWithConcurrency`
  (default cap 3, LLM-supplied `maxConcurrency`, no user config).
- Headless primitive: `ClineProvider.createBackgroundTask` (ClineProvider.ts
  ~3086) — `isBackground: true`, never on the stack; registry
  `backgroundTasks: Map<string, Task>` (line 144) also holds memory writers.
- Invisibility mechanics: webview state carries only
  `clineMessages: currentTask?.clineMessages` (ClineProvider.ts:2314);
  `TaskHistory.updateClineMessage` (TaskHistory.ts:418) posts `messageUpdated`
  WITHOUT a taskId — background-task updates already leak to the webview and
  are dropped by ts-mismatch (ExtensionStateContext.tsx:379 warn path).
- Asks: `buildSubagentApprovalPolicy` (src/core/task/subagentApproval.ts)
  always decides; followups are auto-approved (empty answer). The
  `AutoApprovalOverride` contract (Task.ts:208) already supports `undefined`
  → fall through to global flow → blocking ask → `interactiveAsk` +
  `TaskInteractive` event machinery (TaskAskSay.ts:540+) — the exact hook
  interactive followups need.
- `askResponse` routing: webviewMessageHandler.ts:654 routes to
  `provider.getCurrentTask()` only.
- Model per mode already exists: `modeApiConfigs`
  (ProviderSettingsManager.getModeConfigId / setModeConfig, UI in Modes view);
  `handleModeSwitch` (ClineProvider.ts:1456) resolves it for foreground tasks.
  `createBackgroundTask` ignores it — children always inherit the CURRENT
  profile (`state.apiConfiguration`).

## Design

Four stacked branches, smallest coherent units, oldest-first:

### A. `feat/subagent-visibility` — see the fan-out live

Extension:

- `SubagentSummary` type (packages/types): `taskId, parentTaskId, index,
mode, description, status: "running"|"awaiting_input"|"completed"|"failed"|
"cancelled", apiConfigName?, tokensIn, tokensOut, totalCost, startedAt,
lastActivityAt`.
- `createBackgroundTask` gains `subagentInfo?: {parentTaskId, index,
description, mode}`. Memory writers don't pass it → stay invisible.
- ClineProvider keeps `subagentSummaries: Map<taskId, SubagentSummary>`,
  updated from existing task events (TaskInteractive → awaiting_input,
  TaskCompleted/TaskAborted terminal, TaskTokenUsageUpdated → tokens) in
  `taskCreationCallback`, plus creation/outcome in RunParallelTasksTool.
  A new fan-out for the same parent clears the previous one's entries.
- State: `subagents: SubagentSummary[]` in `getStateToPostToWebview` +
  push-type `subagentsUpdated`.
- Live tail: `messageUpdated` gains `taskId`; webview subscribes per subagent
  (`subscribeSubagentMessages` / `unsubscribeSubagentMessages` WebviewMessage,
  snapshot reply `subagentMessages {taskId, messages}`, then incremental
  `messageUpdated` routed by taskId). Fixes the existing leak: webview now
  drops non-current, non-subscribed updates silently instead of warning.

Webview:

- `SubagentsPanel` above chat input (pattern: `FileChangesPanel` /
  `QueuedMessages` in ChatView.tsx): row per subagent — status dot/spinner,
  mode badge, short description, tokens, elapsed. Expand → live tail
  (simplified renderer: say text/reasoning as Markdown, tool calls as compact
  labels — NOT ChatRow, which is coupled to current-task handlers).
- Shows subagents whose `parentTaskId` matches the current task chain; keeps
  terminal rows visible until the fan-out result returns to the parent.

### B. `feat/subagent-interaction` — talk to a child

- `buildSubagentApprovalPolicy`: `followup` asks return `undefined` (fall
  through → blocking ask, `interactiveAsk`, `TaskInteractive`) instead of
  blind approve. Fallback timer (RunParallelTasksTool attaches on
  TaskInteractive): if the user hasn't answered within
  `subagentFollowupTimeoutSec` (branch C; interim constant 300s), respond as
  today (approve, empty answer) so unattended fan-outs never hang. Timer
  respects `alwaysAllowFollowupQuestions` (global flow already auto-answers
  with first suggestion after `followupAutoApproveTimeoutMs`).
- `askResponse` WebviewMessage gains optional `taskId`; handler resolves via
  new `provider.getBackgroundTask(taskId)` before falling back to current.
- Panel: pending question rendered with suggestion buttons (reuse
  FollowUpSuggest-style rendering) + free-text input; "awaiting_input" badge.
- Send guidance mid-run: route a queued message into the child's
  `messageQueueService` (`queueSubagentMessage {taskId, text}`) — existing
  drain in TaskAskSay delivers it at the next ask boundary.
- Per-subagent cancel: `cancelSubagent {taskId}` → `task.abortTask()`;
  summary → "cancelled"; pool slot frees (awaitTaskCompletion resolves).

### C. `feat/subagent-settings` — configuration UI

- Global settings (packages/types/src/global-settings.ts, optional numbers):
    - `parallelTasksMaxConcurrency` (default 3, clamp 1–8): hard cap; LLM
      `maxConcurrency` arg is clamped to it in `validateParallelParams`.
    - `subagentFollowupTimeoutSec` (default 300, 0 = auto-answer immediately,
      i.e. pre-B behavior).
- New "subagents" settings section (sectionNames + icon + i18n + render
  block in SettingsView.tsx; component pattern: NotificationSettings) with
  the two numeric controls; flows through the generic `updateSettings` path.
- Native tool description (`src/core/prompts/tools/native-tools/
run_parallel_tasks.ts`) notes the cap so weak models aren't told to exceed it.

### D. `feat/subagent-mode-model` — model per task

- `RunParallelTasksTool.runOneSubtask`: resolve the subtask mode's pinned
  profile (`providerSettingsManager.getModeConfigId(mode)` → `getProfile`)
  and pass it as `apiConfiguration` to `createBackgroundTask`; fall back to
  the current profile. Same semantics a foreground mode switch already has —
  the existing per-mode profile picker (Modes view) becomes the "choose the
  model per task type" UI; no new LLM-facing protocol (weak-model safe).
- Panel shows the resolved profile/model name per subagent.

## Non-goals

- Full ChatView takeover per subagent (v2 if the tail proves insufficient).
- Persisting subagent sessions to task history (completed children are
  disposed + files cleaned; unchanged).
- Changing the `new_task` (sequential delegation) flow.

## Verification

- Unit: RunParallelTasksTool.spec (clamp, registry lifecycle, timeout
  fallback), subagentApproval.spec (followup falls through), provider
  summary-lifecycle test, webview panel tests.
- `pnpm check-types`, targeted `vitest` per package.
- Manual: orchestrator fan-out of 3 ask-mode subtasks → panel shows 3 live
  rows; expand one → streaming tail; child followup → badge + answer routes
  back; cancel one → others unaffected; settings cap 1 → serial execution;
  pin a cheap profile to ask mode → panel shows that profile on ask subtasks.

## Outcome

(fill at stack end)
