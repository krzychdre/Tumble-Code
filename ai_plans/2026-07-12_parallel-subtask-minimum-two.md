# Parallel subtasks: require ≥ 2 subtasks; cap < 2 = feature off

**Date:** 2026-07-12
**Base:** `fix/parallel-subtask-scope-guidance` (12086976d)
**Status:** IN PROGRESS

## Problem (user-reported)

1. Models call `run_parallel_tasks` with a SINGLE subtask. The whole point of
   the fan-out is concurrency; one subtask is pure overhead (worktree,
   headless child, report plumbing) over just doing the job in the current
   task (or `new_task` for a specialist).
2. The `parallelTasksMaxConcurrency` setting allows 1, which is a
   contradiction: "parallel, but one at a time". The user wants < 2 to mean
   OFF — the settings slider should read "Off" below 2 and count 2–8.

## Fix (single branch `fix/parallel-subtask-minimum-two`)

- `validateParallelParams`: reject `subtasks.length < 2` with a corrective
  error — do a single job directly in this task, or `new_task` for a
  different specialist; fan-outs only pay off with several jobs.
- Cap semantics: `parallelTasksMaxConcurrency < 2` disables the tool:
    - ApiRequestBuilder appends `run_parallel_tasks` to `disabledTools` for
      ALL tasks when the state cap is < 2 (tool disappears from requests);
    - `RunParallelTasksTool.execute` refuses at runtime with "disabled in
      settings" steering (covers hallucinated calls / stale prompts);
    - clamp floor stays ≥ 2 when enabled (a 2-subtask fan-out may still run
      with concurrency 2; the LLM can no longer request an effective 1, and a
      "1" from the model is treated as invalid → default).
- Settings UI: slider stays 1–8 but renders "Off" at 1; descriptions updated
  (en+pl). Default remains 3.
- Tool description: "you need AT LEAST TWO independent subtasks" rule.
- Tests: new validation/refusal cases; existing single-subtask fixtures
  updated to two subtasks where the count was incidental.

## Verification

- vitest: RunParallelTasksTool.spec (validation, disabled-cap refusal),
  types + prompts suites; `pnpm check-types` for types/src/webview.
- Manual: settings slider to Off → orchestrator requests lack the tool and a
  forced call is refused; single-subtask call → corrective error; 3-subtask
  call runs as before.

## Outcome

Shipped 2026-07-12 on `fix/parallel-subtask-minimum-two` (new stack TIP).

- `validateParallelParams` rejects `subtasks.length < 2` ("AT LEAST 2 …
  do it directly or new_task") and treats model `maxConcurrency < 2` as
  invalid → default (no sequential "parallel" runs).
- New `MIN_PARALLEL_TASKS_CONCURRENCY = 2` + `isParallelTasksEnabled()` in
  @roo-code/types — single source of truth for the Off rule, used by:
  ApiRequestBuilder (strips run_parallel_tasks from ALL foreground requests
  when the cap is Off), RunParallelTasksTool.execute (runtime refusal with
  new_task steering, before validation/approval), SubagentSettings slider
  (renders "Off" below 2; en+pl descriptions updated).
- Tool description: "AT LEAST TWO subtasks" added to the qualifying test.
- Tests: 2 new cases (single-subtask rejection, Off-cap refusal); existing
  single-subtask fixtures updated to two. Green: 29 tool tests, 502
  task/prompts, 208 types; types/src/webview typecheck clean.
