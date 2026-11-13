# r4 follow-up: App characterization spec renders inside act()

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")
- `ai_plans/2026-10-23_23-40_r4-ci-timing-flakes.md` (the same fix for the `Spinner` test)

## Touched files

- `apps/cli/src/ui/__tests__/App.characterization.test.tsx`

## Problem

The spec fakes the timers and waited for React by awaiting a real `setImmediate` between timer advances.
React's scheduler renders on its own real macrotask, so whether a frame was rendered when the spec read it
depended on the order of two macrotasks, the construction that made the `Spinner` test flaky.

## Change

The spec sets `IS_REACT_ACT_ENVIRONMENT` and runs every step inside `act()`: the mount, each extension message,
each keystroke, each client event (new harness method `clientEvent`) and each round of timer advances in `flush`.
`act()` renders and runs effects before it returns, so no real macrotask is awaited any more. `snap` takes the
time to advance, which the follow-up countdown case uses instead of its own advance outside `act()`.

## Tests

- Snapshots byte-identical (same md5 of the `.snap` file before and after).
- 20 sequential runs with `--maxWorkers=2`: 20 passed. 13 runs while four busy loops held four cores for a minute
  (load average about 8 on 12 cores): 13 passed.
- Removing `act()` from the timer rounds in `flush` fails 9 of the 12 cases, so the frames depend on `act()` and
  not on a lucky macrotask order.
