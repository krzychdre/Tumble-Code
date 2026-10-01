# Remove the dead `silentWrites` task flag

Status: implemented on `chore/remove-silent-writes` (simplification round 2, item B1).

## Touched files

- `src/core/task/Task.ts` (option, field, constructor default and assignment)
- `src/core/webview/BackgroundTaskRunner.ts` (option and pass-through)
- `src/core/tools/RunParallelTasksTool.ts` (`SubtaskProvider` option type)
- `src/core/tools/WriteToFileTool.ts`, `src/core/tools/helpers/applyComputedEdit.ts` (the `task.silentWrites ||` branches)
- specs: `editPipeline.spec.ts`, `toolStreamState.onTask.spec.ts`, `toolStreamState.perTask.spec.ts`,
  `BackgroundTaskRunner.spec.ts`, `ClineProvider.cancelTask-abort-race.spec.ts`

## Problem

`silentWrites` made a task write files straight to disk without a diff editor tab. The only callers that set it to
`true` were the memory writers, and #423 (`120620a2a`) replaced them with a single completion that writes the files
in code: `git log -S"silentWrites: true"` shows #423 as the last commit that touched such a line (it removed both),
and no production caller passes the option now (`RunParallelTasksTool.ts:323` never did). The flag was still threaded
through `Task`, `BackgroundTaskRunner`, the subtask provider type and both write paths.

## Fix

Delete the option, the field and its two branches. The direct-write rule is now only the
`PREVENT_FOCUS_DISRUPTION` experiment, which is unchanged.

## Tests

- `editPipeline.spec.ts`: the per-tool "silent-writes task stays off-screen" case is deleted; the same direct-write
  path is covered per tool by "writes directly without a diff view when focus-disruption prevention is on".
- The other specs only dropped `silentWrites` from fakes and option objects.
- Affected specs: 7 files, 158 tests pass. `tsc --noEmit` clean.

## Notes / caveats

No behaviour change (nothing set the flag), so no changeset.
