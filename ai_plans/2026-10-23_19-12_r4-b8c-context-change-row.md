# R4-B8c: one chat row writer for context passes

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B8c).

## Touched files

- `src/core/task/TaskContextManager.ts`

## Problem

`handleContextWindowExceededError` (the forced pass after a context-window error) and `manageContextIfNeeded` (the
regular pass) each ended with the same three-way block that says the row for the outcome: `condense_context` with a
`ContextCondense`, `sliding_window_truncation` with a `ContextTruncation`, or `context_pruned` with a `ContextPrune`
(jscpd: 70 lines, 509-578 against 751-818). The audit named only the condense row; the clone covers all three.

## Change

One private `sayContextChange(truncateResult)` says the row for a `ContextManagementResult`; both passes call it at
the same point as before. The two prune comments are merged into the helper's doc. No behaviour change.

## Tests

- `TaskContextManager.*.spec.ts`, `Task.spec.ts`, `autocompact-circuit-breaker.spec.ts`,
  `microcompact-oscillation.spec.ts`, `Task.condense-handler-invalidation.spec.ts` green, unchanged.
- Mutation checks: dropping the prune branch fails `prune-row.spec.ts` and `forced-prune-row.spec.ts` (both passes);
  dropping `condenseId` from the condense row fails the forced condense-row and rewind cases.
