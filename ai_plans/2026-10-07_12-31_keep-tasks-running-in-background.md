# Keep a task running when the user navigates away from it

**Status:** in progress (three stacked branches, see "Delivery").
**Related plans:** `2026-09-28_s1-clineprovider-split.md` (TaskSlot), `2026-10-03_08-40_subagents-panel-and-telemetry-overview.md`
(BackgroundTaskRunner, SubagentRegistry).

## Symptom

The owner watches a running task in the chat panel and opens its subtask, its parent, or the home screen with the
task history. The task they left stops. It should keep working; the history list on the home screen should show a
spinner on the task that is still running. This is meant as the first step towards several tasks running at once.

## What was happening

Every navigation ends in `TaskSlot.clear()`, which calls `task.abortTask(true)` unconditionally:

| User action                                                                  | Path                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| click a history row, a subtask row, "back to parent", a "go to subtask" link | webview `showTaskWithId` -> `ClineProvider.showTaskWithId` -> `createTaskWithHistoryItem` -> `clearCurrentTask()` -> `TaskSlot.clear` |
| "Start New Task" button                                                      | webview `clearTask` -> `ClineProvider.clearTask` -> `clearCurrentTask()`                                                              |
| title-bar "+"                                                                | `registerCommands.ts` `plusButtonClicked` -> `clearCurrentTask()`                                                                     |
| send a new task while another is open                                        | `createTask` -> `clearCurrentTask()`                                                                                                  |

`TaskSlot.clear` (`src/core/webview/TaskSlot.ts`) takes the task out of the slot, emits `TaskUnfocused`, awaits
`abortTask(true)` (sets `abandoned` and `abort`, so the API loop, `say` and `ask` all stop), removes the
provider's event listeners and, for a delegated child, repairs the parent back to `active`. Nothing keeps a
foreground task alive after it leaves the slot: the slot was designed (D7, S1) as the single live foreground task.
The only tasks that live outside it are the headless `run_parallel_tasks` subagents in `BackgroundTaskRunner`.

## Things that break as soon as a task outlives the slot

Simply not aborting would expose these (all verified in the code, file:line in the research notes of this branch):

1. **Profile switch reaches every live task.** `TaskLifecycle.setupProviderProfileChangeListener` updates the
   task's API configuration on every `ProviderProfileChanged`. Opening another task restores that task's profile
   (`ModeProfileBinding.restoreForHistoryItem`), so the task left running would switch models mid-run.
2. **Delegation is slot-bound.** `DelegationService.delegate` requires the parent to be the current task ("Parent
   mismatch" otherwise) and switches the provider's global mode for the child. `DelegationService.complete`
   reopens the parent through `createTaskWithHistoryItem`, which takes over the view.
3. **Webview traffic from a task that is not on screen.** `TaskMessageLog.addToClineMessages` falls back to a full
   state push of the current task for every message of a non-current task; `updateClineMessage` posts
   `messageUpdated` for it (dropped by the webview, but sent per streamed chunk). Some posts carry no task id at all
   (checkpoint updates, context condensing).
4. **Asks of a hidden task have no addressee.** The webview answers only the current task, so a hidden task that
   asks for approval waits until the user opens it again. That is the wanted behaviour; it only has to be visible.
5. **Deleting or disposing** must also stop tasks that are no longer in the slot.
6. **A delegated parent viewed while its child runs** would offer "Resume", which would run the parent
   concurrently with its child.

## Design

### One rule decides keep-alive versus abort

A task that is _working_ when the user navigates away is **detached** (kept alive, out of the slot); a task that
is _at rest_ is aborted exactly as today, because rebuilding it from history yields the same state.

- At rest: aborted or abandoned, or its last message is a finished ask that ends the work (`idleAsks`:
  `completion_result`, `api_req_failed`, `resume_completed_task`, `mistake_limit_reached`,
  `auto_approval_max_req_reached`; `resumableAsks`: `resume_task`).
- Working: everything else, including a task blocked on an _interactive_ ask (tool or command approval, follow-up
  question). Keeping those alive means the user finds the pending approval when they come back.

A detached task that comes to rest (`TaskIdle` / `TaskResumable`) or aborts is finalised and dropped, so the set of
detached tasks is always "tasks working in the background". Nothing accumulates.

Only the user-navigation paths ask for keep-alive (`clearCurrentTask({ keepRunning: true })`). Every other caller
(delegation hand-over, delete, reset, dispose, the public API) keeps today's abort, so a path that was not
considered keeps the old behaviour instead of gaining a new one.

### Where the state lives (no new layer)

`TaskSlot` already owns the foreground task; it gains the detached set (`Map<taskId, Task>`). It is the only
place that knows both, so `findLiveInstance` (already used by the detached fan-out report) simply looks in both.
No new registry class, no new host seam beyond what the slot needs.

- `clear({ keepRunning })`: detaches a working task instead of aborting it; no delegated-parent repair in that
  case (the child did not go away).
- `set(task)`: if the task was detached, it is taken out of the set (re-attach).
- `getLiveTasks()`: the slot occupant plus the detached tasks, for the running-tasks list and for shutdown.
- `abortAll()`: dispose path.

`ClineProvider.showTaskWithId` re-attaches a live instance (`findLiveInstance`) instead of building a fresh one
from history, so the user sees the task exactly where it is, with its pending ask.

### Isolating a task that is not on screen

- Profile listener: applies only to the foreground task. A re-attached task keeps its own configuration (the
  profile restore on re-attach is skipped; the task already runs on its profile).
- `TaskMessageLog`: no full-state fallback and no `messageUpdated` for a task that is neither the foreground task
  nor a watched subagent.
- The few posts without a task id (checkpoint updated, condense started/finished) go out only for the foreground
  task. `interactionRequired` (sound/notification) stays unscoped on purpose: it tells the user a hidden task
  needs them.

### Delegation across placement (branch 2)

Placement follows the hand-over:

- A detached parent that calls `new_task` is aborted as today and its child starts **detached**, with the child's
  mode and profile resolved per task (`getApiConfigurationForMode`, as `BackgroundTaskRunner` does), without
  switching the provider's global mode or profile.
- A child that completes while detached resumes its parent **detached**, unless the user is looking at that
  parent, in which case the parent is rehydrated in place in the foreground (today's path).
- A delegated parent opened while its awaited child is alive is shown without the "Resume" ask.

### Running-tasks list in the webview (branch 3)

The host pushes `runningTasks: Record<taskId, "running" | "awaiting_input">` (slot occupant plus detached tasks
that are working) as part of the state and as a small `runningTasksUpdated` message on status changes, fed by the
existing task-event forwarding table (`taskEventForwarding.ts`). History rows (`TaskItem`, `SubtaskRow`) show
the shared `Spinner` for "running" and an attention icon for "awaiting_input". Shape copied from `memoryActivity`
(global, unscoped), not from `subagentsUpdated` (scoped to the open task).

## Delivery

Three stacked branches, one functionality each:

1. `feat/keep-task-running-on-navigation`: TaskSlot detach/re-attach, navigation call sites, re-attach in
   `showTaskWithId`, isolation of a hidden task (profile listener, webview posts), delete/dispose.
2. `feat/background-delegation`: delegation and completion when parent or child is detached; delegated parent
   view without "Resume".
3. `feat/history-running-indicator`: `runningTasks` contract, host push, webview reducer, spinner on history rows.

## Known limits (deliberately not in this round)

- Two tasks working in the same workspace share it: checkpoints of one capture the other's edits, and a checkpoint
  restore reverts both. Diff tabs of a hidden task still open in the editor, as they do today for the foreground
  task.
- No "stop" button on a history row; a hidden task is stopped by opening it and pressing Stop.
- The global API rate limit (`lastGlobalApiRequestTime`) stays shared by all tasks, and its `rateLimitSeconds`
  comes from the panel's profile (`RetryHandler`).
- The per-profile auto-condense threshold of a task off screen is looked up with the panel's current profile id
  (`getCurrentProfileId(state)` in `TaskContextManager` / `TaskApiLoop`).
- Full state pushes triggered by a task off screen (`Task.ts` queue, `TaskApiLoop`, `TaskStreamProcessor`) still
  happen once per request; they carry the task on screen and are harmless, only wasted.
- The public API (`startNewTask`) and the CLI keep the abort-on-switch behaviour.
- `getApiConfigurationForMode` (shared with the parallel subagents) resolves a mode's profile through
  `ProviderSettingsManager.activateProfile`, which also writes that name as `currentApiConfigName` into the stored
  profile list. The panel's active profile (global state) is not changed; the stored field is not read at runtime.
  Left as is.
- A message typed into the view of a delegated parent (shown without "Resume") is queued; it is lost if the child
  completes and the parent is reopened.

## Tests

### Branch 1 (`feat/keep-task-running-on-navigation`)

- `src/core/webview/__tests__/ClineProvider.task-slot.spec.ts`: leaving a working task detaches it (not aborted,
  listeners kept, found by id); a task blocked on an approval is kept; a task at rest (completion, resume, failed
  request) and a task whose loop never started are destroyed as before; `clearCurrentTask` without `keepRunning`
  still destroys; the CLI destroys; `set` re-attaches; a detached task is destroyed and dropped on `TaskIdle`,
  `TaskResumable` and `TaskAborted`; a detached delegated child does not repair its parent; `destroyDetached`;
  `showTaskWithId` re-attaches the live instance (and rebuilds a task that is not alive). Reverting the detach
  branch in `TaskSlot.clear` fails the detach cases.
- `src/core/task/__tests__/TaskMessageLog.turn-counts.spec.ts`: a task working off screen posts nothing to either
  view kind, yet saves and keeps the cloud contract.
- `src/core/task/__tests__/TaskLifecycle.profile-listener.spec.ts` (new): a profile change updates only the task on
  screen.
- `src/__tests__/single-open-invariant.spec.ts`: user-initiated create and history open leave the previous task
  with `keepRunning`.

### Branch 2 (`feat/background-delegation`)

What changed:

- `DelegationService.delegate` takes the parent from the slot or from the detached set
  (`getLiveTaskInstance`). A parent off screen is destroyed with `destroyDetachedTasks(..., skipDelegationRepair)`,
  the panel's mode is not switched, and the child comes from `ClineProvider.createDetachedChildTask`: `taskMode`
  set, profile from `getApiConfigurationForMode(mode)` else the parent's, `setTaskApiConfigName`, detached before
  `start()`.
- `DelegationService.complete` resumes the parent off screen (`createDetachedTaskFromHistory`, profile from
  `ModeProfileBinding.getApiConfigurationForTask`: the task's own profile by name, else its mode's) only when the
  child worked off screen and the user is not looking at the parent. A parent view on screen is cleared BEFORE the
  parent is marked active, for the same reason the child is (its abort saves the old "delegated" status).
- `DelegationService.detach` (the delegated-parent repair) leaves the parent waiting when the child that goes away
  awaits a grandchild that still works: closing a view of B must not cut A -> B -> C while C runs.
- `ClineProvider.showTaskWithId` opens a parent whose awaited child is alive with `startTask: false` and loads its
  saved messages, so it is shown without the "Resume" ask.
- The on-screen paths call none of the new host members, so they behave exactly as before.

Tests:

- `src/core/webview/__tests__/DelegationService.spec.ts`: delegate from an off-screen parent (no slot change, no
  mode switch, detached child); complete with the child off screen and the user elsewhere (parent resumed off
  screen); complete while the user looks at the parent (cleared while still "delegated", then reopened on screen);
  detach keeps the parent waiting while the grandchild works. Forcing the parent back on screen fails the second.
- `src/core/webview/__tests__/ClineProvider.spec.ts`: `createDetachedChildTask` (mode, profile, lineage, not on
  screen, detached; the parent's profile without a mode profile) and `createDetachedTaskFromHistory`.
- `src/core/webview/__tests__/ModeProfileBinding.getApiConfigurationForTask.spec.ts` (new).
- `src/core/webview/__tests__/ClineProvider.task-slot.spec.ts`: the delegated parent view.
