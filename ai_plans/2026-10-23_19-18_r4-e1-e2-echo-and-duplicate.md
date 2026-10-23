# R4 E1 + E2: settings echo tests and a duplicate mode-switch test

Status: done.

Related plans: `2026-10-23_17-20_maintenance-audit-round-4.md` (items E1, E2).

## Touched files

- `src/core/webview/__tests__/ClineProvider.spec.ts`

## Problem

Five tests (`writeDelayMs`, `soundEnabled`, `autoCondenseContext`, `autoCondenseContextPercent`,
`maxWorkspaceFiles`) each sent `updateSettings { key: value }` through the generic branch of
`messageHandlers/settings.ts` and asserted that the `globalState.update` mock saw the value the test passed in.
One code path, five copies, and the assertion was on a mock.

The top-level "loads saved API config when switching modes" was the same test as the one in
`describe("handleModeSwitch")`, entered through the `mode` message instead of a direct call. The `mode` message
route stays covered by "saves current config when switching to mode without config".

## Change

- One `test.each` over `[key, value]` sends `updateSettings` and asserts the value `getState()` returns and that a
  `state` message was posted. It proves the generic `contextProxy.setValue` write and the `getState()` pick of the
  key, which the old asserts did not.
- The top-level duplicate mode-switch test is deleted.

`ClineProvider.spec.ts`: 4228 lines before, 4161 after. `grep -c 'handles .* message'` drops from 14 to 10
(the plan expected 3; `maxWorkspaceFiles` was the same echo and is folded in too).

## Tests

- `ClineProvider.spec.ts`: 135 passed. Whole `src/core/webview/__tests__`: 58 files, 978 tests passed.
- Mutation: replacing `await provider.contextProxy.setValue(key, newValue)` in `messageHandlers/settings.ts` with
  a no-op turns all five `test.each` rows red; the old echo tests asserted the spy on that very call, so they
  would have caught it too, but not a missing `getState()` pick.
