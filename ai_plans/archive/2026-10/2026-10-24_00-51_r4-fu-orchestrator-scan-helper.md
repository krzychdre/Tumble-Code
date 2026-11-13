# R4 follow-up: one scan helper in the code-index orchestrator

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution": clones outside the plan).

## Touched files

- `src/services/code-index/orchestrator.ts`

## Problem

`startIndexing` ran the incremental scan and the full scan with two copies of the same 40 lines: mark the
collection incomplete, count found and indexed blocks for the progress report, collect batch errors, call
`scanDirectory`, stop on abort, decide the failure. The abort handling (flush the cache, stop the watcher, go to
Standby) was written three times, the third in the `catch`.

## Change

- `scanWorkspace(kind, signal)` does the shared part and returns the block counts and the scan failure, or
  `undefined` when the scan was stopped. The incremental branch keeps its own failure handling (flush, Error state,
  no cleanup) and its log line; the full branch still throws the failure into the common `catch`.
- `stopAfterAbort()` is the one abort path, used by the helper and by the `catch`.
- Dropped the `if (!result) throw` guards and the unused `stats`: `scanDirectory` always resolves to a result
  object (its interface type has no `undefined`).

No behaviour change.

## Tests

The existing code-index specs (707) stay green. Mutations in the helper, each turning at least one orchestrator
case red: no `markIndexingIncomplete`, no abort check after the scan, indexed blocks not counted, found blocks not
counted, batch errors not collected.
