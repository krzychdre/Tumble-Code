# Public API never delivered the delegation events

Branch `fix/api-delegation-events`, from `origin/main` at `b90125aca`.
Reported by S6 round 2 (`2026-09-28_s6-round2-src-type-safety.md`, section
"Bug found").

## Symptom

An extension (or the e2e suite) that listens on the public API for
`taskDelegated`, `taskDelegationCompleted` or `taskDelegationResumed` never
receives them, although delegation (`new_task` opening a child and the child
handing its result back) works.

## Root cause (verified)

- `DelegationService` emits the three events on its host:
  `src/core/webview/DelegationService.ts` `delegate()` (`this.host.emit(TaskDelegated, parentTaskId, child.taskId)`),
  `complete()` step 6 (`TaskDelegationCompleted, parentTaskId, childTaskId, summary`)
  and step 9 (`TaskDelegationResumed, parentTaskId, childTaskId`).
- The host is `ClineProvider`, which hands in
  `emit: (event, ...args) => this.emit(...)`
  (`src/core/webview/ClineProvider.ts`, the `DelegationService` construction),
  so the events land on the provider. `TaskProviderEvents` in
  `packages/types/src/task.ts` already declares them with
  `(parentTaskId, childTaskId[, summary])`.
- `src/extension/api.ts` `registerListeners()` subscribed to them on each
  **Task** inside the `TaskCreated` handler
  (`task.on(RooCodeEventName.TaskDelegated as any, ...)`). No code emits them
  on a Task (`git grep TaskDelegat` finds emitters only in
  `DelegationService`; they are not in `TaskEvents`, which is why the casts
  were needed), so the three listeners never fired.
- The per-task listener also had the wrong shape: it expected
  `(childTaskId[, summary])` and prepended `task.taskId`, while the real
  emission already carries the parent id.

Evidence: the new spec below fails on main with 0 calls for every event and
0 provider listeners for the three names.

## Fix

`registerListeners(provider)` now subscribes to the three events on the
provider, once per provider (not per task), and re-emits them unchanged with
the `RooCodeEvents` payload (`parentTaskId, childTaskId[, summary]`). Both
`as any` casts per event are gone because `ClineProvider.on` and
`API.emit` are typed for these names. Listener lifetime: the listeners live
on the provider, and `ClineProvider.dispose()` calls `removeAllListeners()`,
so a closed tab provider takes them with it; `registerListeners` runs once
per provider (sidebar in the constructor, each new tab in `startNewTask`), so
there is no duplication across tasks or calls.

The stale doc line in `DelegationService.delegate` ("task-level; API forwards
to provider/bridge") now says the event is emitted on the provider.

## Consumers checked

- There is no IPC server any more (`packages/ipc` is gone); the API
  `EventEmitter` is the only outlet. Consumers: other extensions through the
  extension exports and `apps/vscode-e2e`.
- `apps/cli` does not subscribe to API events (no `RooCodeEventName`
  listeners in `apps/cli/src`), and `packages/cloud` does not reference the
  delegation events.

## Tests

- New `src/extension/__tests__/api-delegation-events.spec.ts` (3 tests): a
  real `DelegationService` whose host `emit` is the same closure
  `ClineProvider` uses, over an `EventEmitter` provider and the real `API`.
  Runs `delegate()` and `complete()` and asserts each API event fires once
  with the declared payload, in order Completed then Resumed, with two tasks
  created; plus one provider listener per event after several
  `TaskCreated`s. Commit 1: 3 failed. Commit 2: 3 passed.
- Related specs (`extension/__tests__/`, `DelegationService.spec`,
  `provider-delegation`, `history-resume-delegation`,
  `nested-delegation-resume`, `delegation-events`): 11 files, 75 tests green,
  `--maxWorkers=2`.
