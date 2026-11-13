# Web Stop, messages and approvals hit the sidebar's task: investigation & fix

**Status:** fixed on `fix/bridge-commands-target-task-by-id` (stacked on `fix/bridge-tab-provider-messages`)
**Related plans:** `2026-10-09_bridge-misses-editor-tab-tasks.md`, `2026-10-09_cloud-bridge-route-commands-per-window.md` (server half)
**Touched:**

- `packages/cloud/src/bridge/types.ts`, `commandHandlers.ts` (+ tests)
- `src/extension/bridge.ts`
- `src/core/webview/ClineProvider.ts` (`findLiveTask`, `stopTask`, `cancelSubagent`, `findTaskHost`)
- `src/core/webview/messageHandlers/subagents.ts`
- `src/core/webview/__tests__/ClineProvider.cancelTask-abort-race.spec.ts`, routing snapshot

## Symptom

The owner runs tasks in parallel: sidebar, editor tabs, tasks left running off screen
(detached) and parallel subagents. Stop on the web page of one task must stop that task.

## What was happening

Every web command carries `taskId`, but the extension ignored it:

- `stop_task` called `provider.cancelTask()` of the sidebar provider, which cancels the
  sidebar's current task. A tab task, a detached task or a subagent could not be stopped,
  and a Stop pressed on one task's page stopped whatever the sidebar showed.
- `message`, `approve_ask`, `deny_ask` went to the sidebar's current task as well, so an
  answer typed on task A's page could land in task B.
- The `instanceState` snapshot (running flag, pending ask, tokens, mode) described the
  sidebar's current task whatever task it was sent for, so the web's Stop button state
  for a tab or detached task was wrong.

## Fix

- `BridgeProvider` now has `findTask(taskId)` and `stopTask(taskId)` instead of
  `getCurrentTask()` and `cancelTask()`; the dispatcher addresses `command.taskId`.
- `ClineProvider.findLiveTask(taskId)`: foreground, detached or parallel subagent.
- `ClineProvider.stopTask(taskId)` stops each kind the way the panel does: `cancelTask`
  for the foreground task, `cancelSubagent` for a subagent (moved out of the webview
  handler, which now calls it), and for a detached task `abortReason = "user_cancelled"`,
  `cancelCurrentRequest(true)`, `abortTask()`. "user_cancelled" is what makes a waiting
  `run_parallel_tasks` cancel its subagents, so stopping a parent stops its fan-out.
- `ClineProvider.findTaskHost(taskId)` finds the sidebar or tab that runs a task; the
  bridge host uses it for commands, for `resume_task` (a task live in a tab is shown
  there) and for the snapshot, which now reads the task's own status, ask, tokens and mode.
- Auto-approval changes from the web push state to every panel.

## Tests

- `commandHandlers.test.ts`: stop names its task; a message or approval for another task
  never reaches this one.
- `ClineProvider.cancelTask-abort-race.spec.ts`: stop of a foreground, detached and
  subagent task, and of a task the panel does not run (`false`, `findTaskHost`).
- Routing snapshot: `cancelSubagent` now delegates to `provider.cancelSubagent`.

## Caveats

- With several VS Code windows the server must deliver the command to the right window;
  that is the server half (related plan).
- A command for a task that is not live anywhere (finished, closed) still no-ops, except
  `resume_task`.
