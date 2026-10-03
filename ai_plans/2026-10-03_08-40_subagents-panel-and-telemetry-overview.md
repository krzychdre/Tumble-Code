# Subagents: panel scope, tail scrolling, cloud lineage (overview)

Status: in progress, three stacked branches

The owner reported three defects of `run_parallel_tasks` subagents on 2026-10-03:

1. The subagents panel shows up in a subtask that never fanned out. It should belong to its own task, like the
   edited-files bar.
2. An expanded subagent row has no scrollbar, so what the subagent did cannot be read.
3. On the cloud metrics page the subagents count as standalone tasks instead of subtasks of their parent.

| Branch                                           | Plan                                                                                             | Fixes |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----- |
| `fix/subagents-panel-task-scope`                 | [2026-10-03_08-45_subagents-panel-task-scope.md](2026-10-03_08-45_subagents-panel-task-scope.md) | 1     |
| `fix/subagents-tail-transcript` (on the first)   | [2026-10-03_09-00_subagents-tail-transcript.md](2026-10-03_09-00_subagents-tail-transcript.md)   | 2     |
| `fix/subagent-telemetry-lineage` (on the second) | [2026-10-03_09-30_subagent-telemetry-lineage.md](2026-10-03_09-30_subagent-telemetry-lineage.md) | 3     |

The second and third branches both touch `src/core/webview/BackgroundTaskRunner.ts`, so they are stacked.
