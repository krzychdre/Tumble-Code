# Subagents: use them often when the provider allows it

**Status:** done on `feat/subagents-eager-use` (branch 3 of the subagents stack)
**Related plans:** 2026-10-19_10-00_subagents-background-wait.md, 2026-10-19_10-30_profile-max-concurrent-requests.md
**Touched:** `src/core/prompts/tools/native-tools/run_parallel_tasks.ts`, `packages/types/src/mode.ts` (orchestrator
role), `src/core/tools/RunParallelTasksTool.ts` (`validateParallelParams` default, disallowed-mode error), specs and
prompt snapshots.

## Problem

Owner point 4 (2026-10-19): "Skoro dostawca modelu na to pozwala, wykorzystujmy subagentów często i chętnie (jeśli
to tylko możliwe)".

The tool description told the model to use subagents only for TINY jobs that take a few minutes, and the orchestrator
role said run_parallel_tasks "exists ONLY for several tiny, independent one-shot jobs". Both were written when a
fan-out blocked the parent until the slowest subagent ended and a single subtask was rejected. After branch 1 the
parent stays responsive and collects results one by one, and after branch 2 the user's settings (global cap and each
profile's `maxConcurrentRequests`) decide how many run at once, so the model no longer has to hold back.

A second finding: a call without `maxConcurrency` ran at most 3 subagents (the built-in default) even when the user
raised the cap to 8, so the settings from branch 2 could not take effect for the usual call.

## Change

- Tool description: "USE SUBAGENTS OFTEN", a list of good subtasks (code questions, research, test/build runs, edits
  or feature parts in their own files, checking a hypothesis), the three conditions (self-contained, independent of
  the subtasks running at the same time, done in one go), and the measured rule kept: never slice one review, audit or
  design into chunks. Short sentences, one instruction each, for weak models.
- `maxConcurrency` description: null lets the user's settings decide (recommended).
- `validateParallelParams`: no value (or a value below 2) now means the user's cap, not min(3, cap).
- Orchestrator role, point 2: choose by the KIND of job; long specialist work goes to new_task, every self-contained
  job that can run beside other work goes to run_parallel_tasks "when your tool list includes it" (the slim toolset
  has no subagent tools, and naming an unlisted tool made vLLM GLM loop before).
- The disallowed-mode error (architect/orchestrator) no longer calls subagents "small one-shot jobs".

## Tests

- `RunParallelTasksTool.spec.ts`: no value means the cap (8), below 2 falls back to the cap, disallowed-mode text.
- Prompt snapshots updated (tool arrays, orchestrator system prompts, size table); the only diffs are the two
  descriptions and the orchestrator point 2. The tool array is 75 characters shorter than before.

## Notes

- No capacity number in the prompt: it would put a settings-dependent byte into the cached prompt, and the slot pool
  queues extra subtasks anyway.
- The slim toolset still hides run_parallel_tasks and wait_for_subagents (weak models fan out instead of working).
