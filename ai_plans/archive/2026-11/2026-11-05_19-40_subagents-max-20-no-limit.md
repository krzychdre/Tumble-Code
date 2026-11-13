# Max parallel subagents: up to 20, or no limit

**Status:** done on `feat/subagents-max-20-no-limit`
**Related plans:** `2026-11-05_20-10_model-request-limit-global.md` (stacked on this branch)
**Touched:**

- `packages/types/src/global-settings.ts`: `MAX_PARALLEL_TASKS_MAX_CONCURRENCY` 8 -> 20, `PARALLEL_TASKS_NO_LIMIT = -1`, `parallelTasksCap()`
- `src/core/tools/RunParallelTasksTool.ts`: the cap goes through `parallelTasksCap()`
- `webview-ui/src/components/settings/SubagentSettings.tsx`: slider 1..21, step 21 = No limit
- `apps/cli/src/commands/cli/run.ts`, `apps/cli/src/types/types.ts`, `apps/cli/README.md`, `apps/cli/examples/README.md`: `maxParallelSubagents` 0..20 or -1
- `webview-ui/src/i18n/locales/*/settings.json`: `subagents.maxConcurrency.description` + `noLimit`

## Request

The owner wants up to 20 subagents per session, and a setting without a limit. The per-model
cap (`maxConcurrentRequests`) stays above it; see the related plan.

## Design

- Settings are stored as JSON, which cannot hold Infinity, so "No limit" is the stored value
  `-1` (`PARALLEL_TASKS_NO_LIMIT`). `parallelTasksCap(value)` turns it into `Infinity`; every
  consumer reads the cap through it, and `isParallelTasksEnabled` takes the stored value.
- With `Infinity` the existing arithmetic holds: `validateParallelParams` clamps to the number of
  subtasks, `SubagentSlotPool.fits` never refuses on the global limit, and each profile's
  `maxConcurrentRequests` still caps the subagents on that profile.
- 0 and 1 keep meaning Off, so an existing CLI config with `0` keeps its meaning.

## Tests

- `RunParallelTasksTool.spec.ts`: with No limit, 21 subtasks all start at once. Verified red by
  reading the raw setting instead of `parallelTasksCap()` (the tool then reports itself disabled).
- `system-prompt-input.spec.ts`: No limit keeps the subagent tools in the request.
- `SubagentSettings.spec.tsx` (renamed from `.compact-note.spec.tsx`): End stores `-1` and shows
  No limit; one step back stores 20.
- `run.test.ts`: 20 and -1 accepted, 21 and -2 rejected.
