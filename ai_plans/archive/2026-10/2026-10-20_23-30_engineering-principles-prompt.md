# Engineering defaults in the built-in prompts

**Status:** done on `feat/prompt-engineering-principles`
**Related plans:** 2026-10-10_19-36_compact-small-model-profile.md (compact head)
**Touched:** `src/core/prompts/sections/doing-tasks.ts` (new), `src/core/prompts/sections/index.ts`,
`src/core/prompts/system.ts`, `src/core/prompts/sections/compact/head.ts`, `packages/types/src/mode.ts`,
`CONTRIBUTING.md`, `prefix-stability.spec.ts` and the prompt snapshots.

## Problem

The built-in prompts teach the agent how to use tools and how to talk, but say nothing about the quality of the code
it writes. RULES has one generic line ("follow the project's coding standards and best practices"), and the `code`
role praised "design patterns, and best practices", which nudges a model towards layers and abstractions. Nothing
said anything about commits.

The owner's memory in three other projects shows the cost: the same corrections were learned again in each project,
one session at a time. Speculative options and fallbacks, guards against states that cannot happen, duplicated code
and tests, tests of libraries and of hand-written fakes, comments that justify decisions, and commits made without
being asked. The owner's yardstick for all of them: code a person can maintain without AI help.

## Change

- New stable-head section DOING TASKS (`getDoingTasksSection`), right after OBJECTIVE: eleven short imperative rules
  (maintainability yardstick, YAGNI, no guards for impossible states, minimal bug fix, reuse before create, flat control
  flow, patterns only with a second implementation, tests that can fail because of our code and replace only the
  outermost boundary, comments, literal names, match the surrounding code, no commit/push unless asked). Constant text
  with no inputs, so rule 1 of the KV-cache contract allows it in the head. The first sentence is conditional ("When
  you write or change code"), so it stays true in `ask`, `orchestrator` and `vision`.
- Compact head, RULES: two lines in the same short style (change only what the task needs, no checks for cases that
  cannot happen; reuse instead of copying, no commit unless asked).
- Built-in modes:
    - `code` role: "writes simple, readable code that a person can maintain without AI help".
    - `architect`, new step 4: separate requirements from optional improvements, plan the minimal change first, list each
      extra layer with its cost and benefit. Old steps 4 to 7 become 5 to 8.
    - `debug`: after the user confirms, fix the defect with the smallest change and remove the temporary logs.
    - `orchestrator`, point 3: a review subtask judges only the changed lines, reports obvious errors and better
      approaches rather than style points, and marks unverified claims as hypotheses.

Personal and environment-specific rules (where plans live, branch upstreams, language and terminology) stay in the
owner's own rules files, not in the product.

KV-cache: one-time prefix invalidation. Everything after OBJECTIVE is re-prefilled once per open conversation; the
section is permanent, and every later request shares it across modes.

## Tests

- `prefix-stability.spec.ts`: DOING TASKS joins the stable-head markers after OBJECTIVE. The worst mode pair
  (anything vs orchestrator) now shares 9915 bytes, measured with the spec's own pairwise loop: 7630 plus the
  2283-byte section and its separator. The floor rises from 7400 to 9680, keeping the same margin as before.
- Snapshots updated (40). The only diffs are the new section, the two compact lines, the `code` role, the renumbered
  architect steps and the debug and orchestrator additions. The compact budget test (4,000 characters) still passes.
- No unit test for the section text itself: it is a constant, and the stable-head marker list fails if it goes missing
  or moves.

## Notes

- Not in this change: the memory extractor still saves cross-project rules into each project's memory separately. A
  user-scope memory directory would fix that; it is a feature, not a prompt edit.
