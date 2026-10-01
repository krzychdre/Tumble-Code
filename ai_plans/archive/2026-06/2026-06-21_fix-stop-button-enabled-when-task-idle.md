# Fix: web cockpit Stop button stays enabled when the task is not running

Date: 2026-06-21
Branch: feature/self-hosted-remote-task-control

## Symptom

On the owner's live task page (`/app/.../task`), the **Stop** button is shown and
enabled even when the task is idle (finished its turn, waiting for the next user
message). Stopping an idle task is a no-op at best and confusing at worst.

## Root cause (traced, not assumed)

`isRunning` is the single flag that drives the Stop⇄Resume toggle in the web
cockpit (`live.js` `applyInstanceState`, lines 156-160). It is produced by the
extension's bridge snapshot:

```ts
// src/extension/bridge.ts (before)
isRunning: !!task && !task.abort,
```

`task.abort` is only `true` _after_ an explicit abort. A task that has finished
its turn and is sitting idle (awaiting input) is **not** aborted, so this
expression returns `true` → the cockpit believes the task is running → Stop is
shown.

The authoritative "is this task actively running" signal already exists:
`Task.taskStatus` (`src/core/task/TaskTokenTracking.ts:177`), derived from the
blocking-ask category (`packages/types/src/message.ts`):

- `Idle` — `completion_result`, `resume_completed_task`, `api_req_failed`,
  `mistake_limit_reached`, `auto_approval_max_req_reached` → **not running**
- `Resumable` — `resume_task` → **not running** (Resume is the action)
- `Interactive` — `tool`, `followup`, `command`, `use_mcp_server` → in-flight,
  awaiting approval → **running** (Stop aborts it)
- `Running` — actively streaming → **running**

The webview's own cancel logic confirms `isStreaming` is the live-work signal
(`ClineProvider.cancelTask` waits for `isStreaming === false`); `taskStatus`
wraps that plus the ask states, so it is the right granularity for the cockpit.

### Secondary gap (live propagation)

`BridgeOrchestrator.subscribeToBus` pushes a fresh snapshot on
`TaskModeSwitched`, `TaskTokenUsageUpdated`, `TaskAskResponded`,
`TaskInteractive` — but **not** on `TaskIdle`, `TaskResumable`, `TaskCompleted`,
`TaskAborted`. So even once `isRunning` is correct, when a _running_ task
finishes, no new `instanceState` is emitted and the cockpit never learns the
flag flipped. The API forwards all four events (`src/extension/api.ts:312-347`),
and `snapshot()` always returns a payload, so subscribing is safe.

### Tertiary gap (initial UI default)

`task_detail.html` ships Stop with no `display:none` (Resume has it), so the
_default_ rendered state is "running" before any `instanceState` arrives.

## Fix

1. **`src/extension/bridge.ts`** — derive `isRunning` from `taskStatus`:
   `isRunning = status === Running || status === Interactive`.
2. **`packages/cloud/src/bridge/BridgeOrchestrator.ts`** — also push instance
   state on `TaskIdle`, `TaskResumable`, `TaskCompleted`, `TaskAborted`.
3. **`self-hosted-cloudapi/.../live.js` + `task_detail.html`** — default Stop to
   hidden / Resume shown until an `instanceState` proves the task is running, and
   hide Stop (not just disable) whenever offline. Centralize via `setRunning()`.

## Verification

- Idle task → Stop hidden, Resume shown.
- Running task → Stop shown; on completion the orchestrator pushes Idle state and
  Stop flips to Resume live (no reload).
- Interactive approval → Stop shown alongside inline Approve/Deny.
- Existing `BridgeOrchestrator.test.ts` snapshot mock still type-checks.
