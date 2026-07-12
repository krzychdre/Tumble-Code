# Parallel subtasks: size-based scope guidance (new_task vs run_parallel_tasks)

**Date:** 2026-07-12
**Base:** `feat/memory-activity-visibility` (c7c7cf663)
**Status:** IN PROGRESS

## Problem (user-reported)

After the round-3 mode guard (architect/orchestrator rejected as subtask
modes), the orchestrator routes around it: instead of delegating a code
review to architect via `new_task` (the natural flow), it slices the review
into multiple ASK-mode parallel subtasks — "review half of the project" per
chunk. The guard constrained the MODE, so the model kept the oversized JOB
and just relabeled it.

## Evidence

- `DEFAULT_MODES` orchestrator `customInstructions` (packages/types/src/
  mode.ts:240) describe delegation exclusively via `new_task` and give no
  rule for when `run_parallel_tasks` is appropriate — the model infers its
  own rule from the tool schema and, being the "parallel = faster" option,
  prefers it for large work.
- The `run_parallel_tasks` description says subtasks must be small one-shot
  jobs but never names the anti-pattern (splitting ONE big job into chunks)
  nor tells the model what to use INSTEAD (`new_task`).

## Fix (prompt-only, weak-model steering; no protocol change)

1. `run_parallel_tasks` native description:
    - qualifying test: a subtask qualifies only if it can be described in a
      sentence or two and completed in a few minutes;
    - explicit anti-pattern: do NOT split one large job (code review, audit,
      design, large refactor) into chunked subtasks — including ask-mode
      chunks; delegate such a job as ONE `new_task` to the right specialist
      mode;
    - sizing rule: if the honest split yields subtasks that are themselves
      big, the job does not belong here.
2. Orchestrator mode `customInstructions`: add the decision rule up front —
   `new_task` for every substantial delegation (reviews, designs, features);
   `run_parallel_tasks` only for several tiny INDEPENDENT one-shot jobs, and
   never as a way to parallelize one big job.

## Verification

- `pnpm check-types` types package; existing mode/prompt specs green.
- Manual: ask the orchestrator for a project review → expect a single
  `new_task` delegation to architect, not an ask-mode fan-out.

## Outcome

Shipped 2026-07-12 on `fix/parallel-subtask-scope-guidance` (new stack TIP).
Prompt-only changes, no protocol/code paths touched:

- run_parallel_tasks description: "WHEN TO USE WHICH DELEGATION TOOL" block
  (one substantial job → ONE new_task; never slice it — including ask-mode
  chunks), a three-part qualifying test (one-two sentences, minutes,
  independent) with concrete qualifying examples, and the sizing rule. Also
  fixed the stale `mode` param hint that still offered "architect".
- Orchestrator mode customInstructions (DEFAULT_MODES): point 2 now leads
  with the size-based tool choice before the existing new_task delegation
  protocol.

Verified: types (208) + tool spec (27) + core/prompts (207) suites green;
types/src typecheck clean.
