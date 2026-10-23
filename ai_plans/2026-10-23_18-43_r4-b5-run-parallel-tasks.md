# R4-B5: RunParallelTasksTool, one exit helper and one limiter

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B5, including the optional R3 part, which
the owner approved).

## Touched files

- `src/core/tools/RunParallelTasksTool.ts`
- `src/core/webview/SubagentSlotPool.ts`
- `src/core/task/Task.ts` (one comment)
- `src/core/tools/__tests__/RunParallelTasksTool.spec.ts`
- `src/core/webview/__tests__/SubagentSlotPool.spec.ts`
- `src/core/prompts/tools/native-tools/__tests__/examples.spec.ts`

## Problem

`runOneSubtask` repeated "mark the panel row terminal, build the result, finalize" at six exits, and handled a
slot-acquire failure that cannot happen (`SubagentSlotPool.acquire` rejects only with `SlotWaitAbortedError`).
`validateParallelParams` re-checked a cap that `execute` had already accepted, `SubagentSlotPool.fits` handled a
missing profile key that no caller sends, `DEFAULT_MAX_CONCURRENCY` aliased a shared constant, `execute` read
`getState()` twice, and the `runWithConcurrency` doc described an `onError` that did not exist.

Two limiters were stacked: `runWithConcurrency` held one call to its `maxConcurrency`, and the slot pool held all
calls to the global cap and each profile to its own cap.

## Change

- `runOneSubtask` ends through one local `end(status, fields)`: it marks the panel row (the last message for a
  completed subagent, the error for a failed one) and returns the result through `finalize`, which only unlocks and
  cleans when the result names a worktree. A rejected `acquire` means the fan-out was aborted and ends as cancelled;
  the separate pre-acquire abort check is gone because `acquire` rejects an aborted signal at once.
- `validateParallelParams` takes the cap as a required argument and uses it as given (`execute` passes it only when
  `isParallelTasksEnabled` accepted it). `execute` reads the provider state once.
- `runWithConcurrency` is deleted. Every subtask of a call asks the slot pool at once; the `SlotRequest` carries the
  call's key (`<parentTaskId>/<runId>`) and `maxConcurrency` as `fanOutKey` and `fanOutLimit`, next to the global and
  per-profile caps. `profileKey` and `fanOutKey` are required.
- Behaviour kept: at most `maxConcurrency` subagents of one call run at once, the subtasks of one call start in input
  order among those that fit, and the global and per-profile caps hold as before.
- Ordering change: a subtask now holds a per-call slot only while it runs, not while it waits. A subtask waiting for
  its full profile no longer blocks a later subtask of the same call on another profile; that later subtask starts in
  its place. Across calls, all subtasks of an earlier call queue at once, so they are served before the subtasks of a
  later call whenever they fit; before, the subtasks beyond the call's first `maxConcurrency` joined the queue only as
  earlier ones ended.

## Tests

- `SubagentSlotPool.spec.ts`: a `req()` helper fills the now-required keys; new cases pin the per-call cap and that a
  call at its cap does not block another call's waiter.
- `RunParallelTasksTool.spec.ts`: the `runWithConcurrency` cases are replaced by execute-level cases: at most
  `maxConcurrency` subagents of one call run at once; a later subtask starts while an earlier one waits for its
  profile (the ordering change); a completed subagent's last message reaches its panel row. The assertion for a
  nonsensical cap (a state `execute` never reaches) is gone.
- Mutation checks: the ordering case fails against the previous `RunParallelTasksTool.ts` and `SubagentSlotPool.ts`;
  dropping the fan-out check in `fits` fails three cases; passing the error instead of the last message to
  `markTerminal` for a completed subagent fails the panel-row case.
