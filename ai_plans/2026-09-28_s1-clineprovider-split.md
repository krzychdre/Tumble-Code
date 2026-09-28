# S1 — ClineProvider split: extract WebviewStatePusher and TaskSlot

Roadmap: ai_plans/2026-09-27_simplification-roadmap.md, item S1:
"`ClineProvider` (2,558): extract `WebviewStatePusher` (the `postStateToWebview*`
family, keeping behaviour) and, after D7, a small `TaskSlot`."

Branch: `refactor/s1-clineprovider-split` off main (04a3a2a7a).
Pure refactor: observable behavior must be IDENTICAL.

## 1. Dependency map (post-D7 ClineProvider.ts, 2,552 lines)

### 1a. The `postStateToWebview*` family (to become WebviewStatePusher)

| Member (ClineProvider)                     | Kind         | Internal deps                                                                                                                         |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `postStateToWebview()`                     | public       | stateBuilder (`getStateToPostToWebview`), `rememberViewClineMessages`, `postMessageToWebview`, `postMdmRedirectToWebview`             |
| `postStateToWebviewWithoutTaskHistory()`   | public       | same, minus taskHistory from the payload                                                                                              |
| `postStateToWebviewWithoutClineMessages()` | public       | same, minus clineMessages + seq                                                                                                       |
| `postClineMessageAdded(task, message)`     | public       | `canSendClineMessageAlone`, stateBuilder, `viewClineMessages`, `postMessageToWebview`, `postMdmRedirectToWebview`, `getCurrentTask()` |
| `postEditedClineMessage(task, message)`    | public       | `webviewAcceptsMessageAdded`, `viewClineMessages`, `postMessageToWebview`                                                             |
| `postMdmRedirectToWebview()`               | private (D4) | `mdmService`, `checkMdmCompliance`, `postMessageToWebview`                                                                            |
| `canSendClineMessageAlone()`               | private      | `getCurrentTask()`, `webviewAcceptsMessageAdded`, `viewClineMessages`                                                                 |
| `rememberViewClineMessages()`              | private      | `view` (getter), `viewClineMessages`                                                                                                  |
| `setWebviewAcceptsMessageAdded()`          | public       | `webviewAcceptsMessageAdded`, `viewClineMessages`                                                                                     |
| state fields                               | private      | `webviewAcceptsMessageAdded`, `viewClineMessages`                                                                                     |

State NOT moving: `clineMessagesSeq` lives in ProviderStateBuilder
(`nextClineMessagesSeq` source) — it stays on the provider, which already owns
the builder wiring.

External callers of the family (production):

- `ClineProvider` internals: constructor wiring (TaskHistoryGateway,
  ModeProfileBinding, CloudProfileSync, CustomModesManager callback), several
  provider methods (`deleteProviderProfile`, `updateCustomInstructions`,
  `createTaskWithHistoryItem`, `refreshWorkspace`, `resetState`).
- `src/core/webview/messageHandlers/taskLifecycle.ts` (resyncClineMessages →
  `postStateToWebviewWithoutTaskHistory`, webviewDidLaunch →
  `setWebviewAcceptsMessageAdded`).
- `src/core/task/TaskMessageLog.ts` / `TaskApiLoop.ts` / `TaskLifecycle.ts` /
  `Task.ts` / `TaskStreamProcessor.ts` (`postClineMessageAdded`,
  `postEditedClineMessage`, `postStateToWebviewWithoutTaskHistory` via
  `providerRef.deref()`; the call is optional-chained `?.`, so the member must
  stay present on ClineProvider's public surface).
- `src/activate/registerCommands.ts`, `src/extension/api.ts`
  (`postStateToWebview`).

Design decision: ClineProvider keeps thin public delegating methods for the
whole family. All external call sites (Task\* classes, messageHandlers, api.ts,
registerCommands, activate) stay untouched; only the method BODIES move into
`WebviewStatePusher`. This keeps the Task-side optional-chained calls
type-checked and avoids churn in ~15 files that only use the provider's public
surface.

### 1b. The single-task slot (to become TaskSlot, from D7)

| Member (ClineProvider)                                     | Kind            | Notes                                                                                                                                                                      |
| ---------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currentTask: Task \| undefined`                           | private field   | the slot storage                                                                                                                                                           |
| `addClineToStack(task)`                                    | public          | sets slot, emits TaskFocused, `performPreparationTasks`, `getState` validation                                                                                             |
| `removeClineFromStack(options?)`                           | public          | clears slot, emits TaskUnfocused, abortTask(true), listener cleanup, delegation repair via `delegation.detach`                                                             |
| `getCurrentTaskStack(): string[]`                          | public          | compat shape `[id]` or `[]`                                                                                                                                                |
| `getLiveTaskInstance(taskId)`                              | public          | slot-scoped lookup                                                                                                                                                         |
| `getCurrentTask()`                                         | public          | TaskProviderLike                                                                                                                                                           |
| in-place rehydrate branch of `createTaskWithHistoryItem`   | private         | pops old listeners, aborts old, `currentTask = task` + TaskFocused + preparation (flicker-free)                                                                            |
| `condenseTaskContext`                                      | public          | reads `currentTask?.taskId === taskId`                                                                                                                                     |
| `dispose`, `resolveWebviewView`, `clearTask`, `createTask` | —               | read/replace the slot through the methods above                                                                                                                            |
| rootTask/taskNumber derivation                             | in `createTask` | `rootTask: parentTask ? (parentTask.rootTask ?? parentTask) : undefined`, `taskNumber: 1` — inline comments explain the D7 equivalence; they move with TaskSlot as its doc |

Host seams the slot needs (constructor-injected deps, mirroring
DelegationService/TaskHistoryGateway style):

- `performPreparationTasks(task)` — provider-specific (LM Studio preload) —
  stays on ClineProvider, injected as a callback.
- `getState()` — for the mode validation in set — injected callback.
- `log(message)` — injected.
- `taskEventListeners` cleanup — the WeakMap lives on ClineProvider
  (`taskCreationCallback` writes it); injected as
  `removeTaskEventListeners(task)` callback.
- `delegation.detach(parentTaskId, childTaskId)` — injected callback.
- `emit` of TaskFocused/TaskUnfocused stays on the Task object itself
  (`task.emit(...)`), as today.

Naming (the rename the task asks for):

- `addClineToStack(task)` → `TaskSlot.set(task)`; ClineProvider public method
  renamed `setCurrentTask(task)` delegating to `slot.set`.
- `removeClineFromStack(options?)` → `TaskSlot.clear(options?)`; provider
  method renamed `clearCurrentTask(options?)` delegating to `slot.clear`.
- `getCurrentTaskStack()` keeps its name and `string[]` return (public API in
  packages/types `RooCodeAPI` + DelegationService host + api.ts) — pure
  compatibility shape; implemented over the slot.

## 2. Seam design

Two new files in `src/core/webview/`, following the existing collaborator
pattern (constructor host-object, no ClineProvider import → no circular
imports; both are created in ClineProvider's constructor):

### `src/core/webview/WebviewStatePusher.ts`

```ts
export interface WebviewStatePusherHost {
	getStateToPostToWebview(options?: { includeTaskHistory?: TaskHistoryInclusion }): Promise<WebviewStatePush>
	postMessageToWebview(message: ExtensionMessage): Promise<void>
	getCurrentTask(): { readonly taskId: string; readonly clineMessages: ClineMessage[] } | undefined
	/** True when the MDM policy requires cloud auth and the user is non-compliant. */
	shouldRedirectToCloudAuth(): boolean
	readonly hasView: boolean
}

export class WebviewStatePusher {
	postStateToWebview(): Promise<void>
	postStateToWebviewWithoutTaskHistory(): Promise<void>
	postStateToWebviewWithoutClineMessages(): Promise<void>
	postClineMessageAdded(task, message): Promise<boolean>
	postEditedClineMessage(task, message): Promise<void>
	postMdmRedirectToWebview(): Promise<void> // public on the class; provider keeps it private-delegated
	setWebviewAcceptsMessageAdded(accepts: boolean): void
}
```

- Owns `webviewAcceptsMessageAdded` + `viewClineMessages` private fields
  (they were only used by this family).
- The provider keeps `postMdmRedirectToWebview` as a private delegator ONLY if
  some spec still spies it — ClineProvider.spec `postMdmRedirectToWebview`
  describe-block spies `(provider as any).postMdmRedirectToWebview`. That spy
  would silently stop intercepting. Per the task rules ("adjusting only the
  mock seam if the method moves class, never the assertions"): the provider
  keeps a private delegating `postMdmRedirectToWebview()` (used by the family
  internally through `this.statePusher.postMdmRedirectToWebview()`) — NO,
  cleaner: the family methods on the provider delegate to the pusher, and the
  pusher's variants call `this.postMdmRedirectToWebview()` as an own method.
  The spec's spy is retargeted to the pusher instance (`(provider as
any).statePusher.postMdmRedirectToWebview`) — same assertion, mock seam
  moved with the method. The `hasView`/`getCurrentTask` indirection keeps the
  pusher free of provider back-references except through the typed host
  object.
- `shouldRedirectToCloudAuth()` on the provider = the old
  `mdmService?.requiresCloudAuth() && !checkMdmCompliance()` conjunction;
  `checkMdmCompliance` itself stays public on the provider (used elsewhere? —
  verify: it is referenced in the constructor's stateBuilder wiring;
  it stays).

### `src/core/webview/TaskSlot.ts`

```ts
export interface TaskSlotHost {
	log(message: string): void
	getState(): Promise<{ mode?: unknown }>
	performPreparationTasks(task: Task): Promise<void>
	removeTaskEventListeners(task: Task): void
	detachDelegatedParent(parentTaskId: string, childTaskId: string): Promise<boolean>
}

export class TaskSlot {
	get current(): Task | undefined
	setCurrent(task: Task): Promise<void> // was addClineToStack
	replaceCurrentInPlace(task: Task): Promise<void> // flicker-free rehydrate half
	clear(options?: { skipDelegationRepair?: boolean }): Promise<void> // was removeClineFromStack
	getTaskIds(): string[] // was getCurrentTaskStack's shape
	findLiveInstance(taskId: string): Task | undefined
}
```

- `createTaskWithHistoryItem`'s in-place rehydrate branch delegates: abort old
    - listener cleanup + slot replace + TaskFocused + preparation =
      `slot.replaceCurrentInPlace(task)`. The provider keeps the surrounding
      orchestration (isRehydratingCurrentTask check, logging).
- Log strings keep their original text (specs assert on "Repaired parent X
  metadata", "Failed to repair parent metadata for X (non-fatal)") — only the
  `[ClineProvider#removeClineFromStack]` prefix is updated to
  `[TaskSlot#clear]`… careful: `removeClineFromStack-delegation.spec.ts` asserts
  `stringContaining("Failed to repair parent metadata for parent-1 (non-fatal)")`
  — that part stays identical. `stringContaining("Repaired parent parent-1
metadata")` also stays. Only method-name prefixes inside brackets change.
- TaskSlot has NO import of ClineProvider (type-only import of Task, same as
  DelegationService).

Provider-level renames (all callers updated):

- `addClineToStack` → `setCurrentTask` (internal + specs)
- `removeClineFromStack` → `clearCurrentTask` (internal, api.ts,
  registerCommands, TaskHistoryGateway/DelegationService host interfaces,
  specs)
- `getCurrentTaskStack()` — name kept (public API compat), body →
  `slot.getTaskIds()`.

ClineProvider retains thin delegators so external seams (Task classes calling
`providerRef.deref()?.postStateToWebviewWithoutTaskHistory()` etc.) are
unchanged.

## 3. Spec-impact inventory

| Spec                                                                                                                                                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                           | Assertions |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `src/core/webview/__tests__/ClineProvider.task-slot.spec.ts`                                                                                                                                                                                                                                    | prototype-seam stand-in retargeted to TaskSlot (`TaskSlot.prototype` methods over a stand-in host) or direct TaskSlot unit tests; renamed vocabulary in calls                                                                                                                                    | unchanged  |
| `src/__tests__/removeClineFromStack-delegation.spec.ts`                                                                                                                                                                                                                                         | RENAMED → `src/__tests__/clear-current-task-delegation.spec.ts`; `(ClineProvider.prototype as any).removeClineFromStack.call(provider)` → direct `new TaskSlot(host).clear()` calls (the delegation-repair logic now lives in TaskSlot.clear; provider stand-ins keep `currentTask` → slot seam) | unchanged  |
| `src/core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts`                                                                                                                                                                                                                          | `removeClineFromStack` spies → `clearCurrentTask`; `(provider as any).currentTask` setup → `(provider as any).taskSlot.current`-compatible accessors or keep provider field delegating                                                                                                           | unchanged  |
| `src/core/webview/__tests__/ClineProvider.spec.ts`                                                                                                                                                                                                                                              | `addClineToStack`/`removeClineFromStack` calls renamed; `postMdmRedirectToWebview` spy retargeted to `statePusher`; `(provider as any).viewClineMessages` poke retargeted to `(provider as any).statePusher`                                                                                     | unchanged  |
| `src/core/webview/__tests__/ClineProvider.taskHistory.spec.ts`                                                                                                                                                                                                                                  | none expected (uses public family methods)                                                                                                                                                                                                                                                       | unchanged  |
| `src/__tests__/task-resume-ui.spec.ts`                                                                                                                                                                                                                                                          | stack-vocab mocks renamed (`removeClineFromStack:` key → `clearCurrentTask:`)                                                                                                                                                                                                                    | unchanged  |
| `src/__tests__/single-open-invariant.spec.ts`                                                                                                                                                                                                                                                   | mock keys renamed                                                                                                                                                                                                                                                                                | unchanged  |
| `src/__tests__/provider-delegation.spec.ts`, `nested-delegation-resume.spec.ts`, `history-resume-delegation.spec.ts`                                                                                                                                                                            | mock keys renamed (DelegationService host mocks)                                                                                                                                                                                                                                                 | unchanged  |
| `src/core/webview/__tests__/DelegationService.spec.ts`                                                                                                                                                                                                                                          | host mock keys renamed                                                                                                                                                                                                                                                                           | unchanged  |
| `src/core/webview/__tests__/TaskHistoryGateway.spec.ts`                                                                                                                                                                                                                                         | host mock keys renamed                                                                                                                                                                                                                                                                           | unchanged  |
| `src/core/webview/__tests__/ClineProvider.historyReopenAllowList.spec.ts`, `cancelTask-abort-race.spec.ts`, `delegation-cancel-races.spec.ts`, `ClineProvider.sticky-*.spec.ts`, `apiHandlerRebuild.spec.ts`, `ClineProvider.reacquire.spec.ts`, `storageError.spec.ts`, `stateBuilder.spec.ts` | `(provider as any).currentTask = X` pokes → slot accessor; `addClineToStack` renames                                                                                                                                                                                                             | unchanged  |
| `src/core/task/__tests__/Task.completion-memory-writers.spec.ts`                                                                                                                                                                                                                                | `provider.currentTask = task` → slot seam; `clearTask` path unchanged                                                                                                                                                                                                                            | unchanged  |
| `src/extension/__tests__/api-*.spec.ts`                                                                                                                                                                                                                                                         | `removeClineFromStack` mock key renames                                                                                                                                                                                                                                                          | unchanged  |
| `src/__tests__/new-task-delegation.spec.ts`, `provider-delegation.spec.ts`                                                                                                                                                                                                                      | grep-verified renames                                                                                                                                                                                                                                                                            | unchanged  |

`(provider as any).currentTask = X` handling: ClineProvider keeps a private
field `taskSlot: TaskSlot`, and TaskSlot exposes the raw slot through
`get current()`/set. Specs poke `(provider as any).taskSlot.current = X`? —
No: to keep spec churn minimal and behavior identical, ClineProvider keeps a
public accessor pair: `getCurrentTask()` already exists; specs that WRITE the
slot use `(provider as any).taskSlot["current"] = X` via a small setter. Task
writer will use whichever compiles cleanly with `useDefineForClassFields`
semantics; the plan is: TaskSlot.current is a get/set pair, specs write
`(provider as any).taskSlot.current = X`.

## 4. Verification plan

- `cd src && npx vitest run` for all affected suites (ClineProvider\*.spec,
  flicker-free-cancel, task-slot, taskHistory, delegation suites,
  single-open-invariant, task-resume-ui, removeClineFromStack-delegation
  (renamed), Task.completion-memory-writers, api specs, layering.spec).
- Typecheck: `npx tsc --noEmit` in src (or the repo's check script).
- ESLint on touched files.
- `pnpm knip` — baseline exit 1 pre-existing; diff findings, must be none new
  (WebviewStatePusher + TaskSlot are consumed by ClineProvider; host interfaces
  exported for constructor typing — check `ignoreExportsUsedInFile` and that
  exports are used cross-file).
- Line counts before/after reported in attempt_completion.

## 5. Docs

- `docs/02-extension-host.md`: update the mermaid graph (add WebviewStatePusher
    - TaskSlot nodes, remove `clineStack: Task[]`), rewrite "The task stack"
      section to "The task slot" with the new method names, note delegation of the
      pusher family.
- `docs/architecture.md`: line ~128 mentions the postStateToWebview\* variants —
  add that they live in `WebviewStatePusher` with ClineProvider delegating.

## 6. Changeset

`.changeset/s1-clineprovider-split.md`, `"tumble-code": patch`, describing the
internal refactor and the method renames.
