# Compact profile: no subagents

Status: done on `feat/compact-no-subagents` (local only, cut from the PoC head `ec0603d3b`, not merged). Overview and
invariants: `2026-10-10_19-36_compact-small-model-profile.md`.

## Subagents off under compact

The compact toolset hides `new_task` and `run_parallel_tasks`, but dispatch is tolerant, so a hidden tool the model
calls anyway still runs and could start a subagent. The subagent settings (`parallelTasksMaxConcurrency` and the
others) are global and stay untouched; the owner wants subagents off for compact profiles only, at runtime.

- `NewTaskTool.execute` and `RunParallelTasksTool.execute` refuse the call right after the background check, before
  any state read, parameter validation or approval ask, when `isCompactProfile(task.apiConfiguration)`. The tool
  error (from `src/core/tools/helpers/compactSubagents.ts`, wrapped in `formatResponse.toolError` without the tool
  name, so no minimal example of the refused tool is attached), with `<tool>` the tool name:

    ```
    <tool> refused: subagents are off for this profile (compact mode). Do the work yourself with your own tools, then call attempt_completion.
    ```

- The refusal goes through `BaseTool.recordFailure` without `failTurn`: it grows `consecutiveMistakeCount` (a model
  that loops on the refused tool reaches the mistake limit) and leaves `attempt_completion` open.
  `recordToolError` alone, used by the background check, records the error without counting a mistake.
- `NewTaskTool.handlePartial` shows no "newTask" card under compact. `RunParallelTasksTool.handlePartial` is already
  a no-op.
- No checkpoint: `new_task` is a checkpointed tool, and both the save before the tool runs
  (`presentAssistantMessage`) and the early start at `tool_call_start` (`StreamToolCallHandler`) now ask
  `isCheckpointedCall(name, task profile)` in `src/core/checkpoints/checkpointedTools.ts`, which is false for a
  compact `new_task` and equal to `isCheckpointedTool(name)` otherwise.
- Flag absent or false: unchanged (the existing tool specs pass untouched, `compact-off-golden.spec.ts` passes).

Tests: `src/core/tools/__tests__/subagents-compact-profile.spec.ts` (both refusals, the repeated count, the exact
text, no card while streaming, flag absent and false unchanged) and two compact cases in
`src/core/checkpoints/__tests__/checkpointed-tools.spec.ts`.

Other paths checked (no change needed):

- No tool alias resolves to `new_task` or `run_parallel_tasks` (`TOOL_ALIASES` in `packages/types/src/tool.ts`), and
  the handler table maps each name to exactly one tool, so the two guards cover every model tool call.
- `provider.delegateParentAndOpenChild` (`DelegationService`) is called only by `NewTaskTool` in production
  (`TaskSubtasks.startSubtask` is unused outside tests); `createBackgroundTask` only by `RunParallelTasksTool`.
- `run_slash_command` and `skill` return text and may switch the mode, but start no task; `tools_load` only loads
  schemas, and a loaded `new_task` still dispatches to the guarded tool.
- The memory writer (extract, dream) is a side query on the writer or task profile, not a subagent task.
- Not changed: `AssistantMessageAssembler` still truncates the tools after a `new_task` in the same message (the
  delegation isolation rule), although a compact `new_task` is refused and delegates nothing. At the mistake limit,
  if the user replies, `tooManyMistakes` attaches `new_task`'s minimal example, as it already does after the
  delegation-loop refusal.
