# TE-4: `awaitTaskCompletion` leaks a background-task entry and hangs `runWithConcurrency`

**Branch:** `fix/await-task-completion-leak`
**Date:** 2026-07-12
**Finding:** TE-4 [med]

## Root cause

`ClineProvider.awaitTaskCompletion` (src/core/webview/ClineProvider.ts ~3135) returns a
promise that resolves ONLY on `TaskCompleted` or `TaskAborted`. If a Task is disposed
without either terminal event firing, the promise stays pending forever: the
`backgroundTasks` Map entry leaks, `runOneSubtask` never returns, and
`runWithConcurrency`'s `Promise.all` hangs.

## Call graph (pre-fix)

- `Task.abortTask()` -> `TaskLifecycle.abortTask()` -> emits `TaskAborted` (line 551) ->
  `TaskLifecycle.dispose()` (line 577). Terminal event IS emitted before disposal.
- `Task.dispose()` (public, test-only in production) -> `TaskLifecycle.dispose()` +
  `Task.removeAllListeners()`. NO terminal event emitted. Listeners removed -> waiters
  hang.
- `AttemptCompletionTool.emitTaskCompleted()` -> emits `TaskCompleted` -> later
  `abortTask(true)` for cleanup -> emits `TaskAborted` then disposes.

**Re-entrancy:** `abortTask()` emits `TaskAborted` BEFORE calling `dispose()`, so when
`dispose()` is reached via `abortTask()`, the terminal flag is already set -> no double
emission.

## Fix design

Fix at the SOURCE: make `Task.dispose()` emit `TaskAborted` when no terminal event has
fired yet, BEFORE `removeAllListeners()`.

### Flag: `terminalEventEmitted`

- Private boolean on `Task`, default `false`.
- Set to `true` by an `emit()` override whenever `TaskCompleted` or `TaskAborted` is
  emitted. The override catches every emitter (`TaskLifecycle.abortTask`,
  `AttemptCompletionTool`, any future caller) through a single chokepoint.
- In `dispose()`: if the flag is unset, emit `TaskAborted` (sets the flag), then proceed
  with `lifecycle.dispose()` + `removeAllListeners()`.
- Re-entrancy safe: if `dispose()` is called from within `abortTask()` (which already
  emitted `TaskAborted`), the flag is already `true` -> skip the emit.

### `emit()` override

```typescript
public override emit<K extends keyof TaskEvents>(
    event: K,
    ...args: TaskEvents[K]
): boolean {
    if (event === RooCodeEventName.TaskCompleted || event === RooCodeEventName.TaskAborted) {
        this.terminalEventEmitted = true
    }
    return (super.emit as (event: K, ...args: TaskEvents[K]) => boolean)(event, ...args)
}
```

The cast through `super.emit` is needed because Node's EventEmitter typings use a
conditional `Args<K, T>` that TypeScript can't relate back to `TaskEvents[K]` when
spreading generic rest tuples. Runtime behaviour is correct.

## Files changed

- `src/core/task/Task.ts` — added `terminalEventEmitted` flag, `emit()` override,
  `dispose()` emits `TaskAborted` when flag is unset.
- `src/core/task/__tests__/Task.dispose.test.ts` — 5 new tests:
    1. `dispose()` emits `TaskAborted` when no terminal event fired.
    2. `dispose()` does NOT emit when `TaskCompleted` already fired (no double-emit).
    3. `dispose()` does NOT emit when `TaskAborted` already fired (no double-emit).
    4. `dispose()` emits BEFORE `removeAllListeners` so waiters still fire.
    5. Integration: `awaitTaskCompletion`-style listener resolves on `dispose()` (race
       against 2s timeout, pre-fix hangs).

## Verification

- `npx vitest run core/task/__tests__/Task.dispose.test.ts` — 9/9 pass.
- `npx vitest run core/webview/__tests__/backgroundTask.spec.ts` — 12/12 pass.
- `npx vitest run core/tools/__tests__/RunParallelTasksTool.spec.ts` — pass.
- `npx vitest run core/task/__tests__/` — 296/296 pass (7 pre-existing unhandled
  errors from memory paths not initialized in test env, unrelated).
- `npx vitest run core/webview/__tests__/` — 323/323 pass.
- `npx tsc --noEmit` — zero new errors (only pre-existing `zai.ts:129`).
