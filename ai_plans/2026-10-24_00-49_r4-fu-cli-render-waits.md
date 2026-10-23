# r4 follow-up: CLI tests that wait on time instead of on the code

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")
- `ai_plans/2026-10-24_00-42_r4-fu-cli-characterization-act.md` (the App characterization spec, fixed first)

## Touched files

- `apps/cli/src/ui/hooks/__tests__/useExtensionHost.test.tsx`

## Problem

The sweep looked for the construction behind the `Spinner` flake (fake timers plus reading ink output without
`act()`) and for fixed `setTimeout`/`setImmediate` sleeps used as a render wait, in every `apps/cli` test.

ink renders in a legacy root, so a keypress, a `rerender` or a store update renders synchronously and its
effects run in the same commit; the 10 ms sleeps after a keystroke wait for nothing, and React's scheduler task
is not on their path. This was measured, not assumed: with a setup file that delays every `setImmediate` (the
scheduler's task) by 30 ms, all 16 React test files with sleeps pass, and with a 1.5 s delay the files with
`vi.waitFor` and `pWaitFor` waits pass too. Five runs of the 18 files with sleeps while four busy loops held four
cores (load average 14 on 12 cores) were green. The real-timer waits in `useTranscriptSink`, `useGlobalInput`,
`ModelPicker` and `process-guards` are ordered behind a timer the code under test registers first, so they
cannot lose the race.

One wait was timing-dependent: `useExtensionHost` "exits with --oneshot when the task completes" waited up to
2 s of real time for the hook's `setTimeout(() => process.exit(0), 100)`, and it is the known intermittent red on
the Windows runner.

## Change

Both --oneshot cases complete the task through a `completeTask` helper that switches `setTimeout` to a fake clock
and advances it by the hook's 100 ms, so the exit is checked after exactly that delay whatever the runner's speed.
The resumed-task case uses the same helper instead of a 150 ms real sleep.

## Tests

- `useExtensionHost.test.tsx`: 5 passed, 10 repeated runs green.
- Mutations: removing the delayed `process.exit(0)` fails "exits with --oneshot"; dropping `!resumed` from the
  exit condition fails "does not exit with --oneshot when a completed task is resumed".
