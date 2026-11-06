# apply_patch `*** Move to:` bypassed a mode's file restriction (audit X-1)

**Status:** done on `fix/sec-ext-fs-boundary`
**Related:** `private_docs/security-audit-2026-11-06/report.md` X-1
**Touched:** `src/core/tools/validateToolUse.ts`, `src/core/tools/__tests__/validateToolUse.spec.ts`

## Problem

A mode limited by `fileRegex` (architect, reviewer, any `\.md$` custom mode) could write any file: update an
allowed `a.md` and rename it with `*** Move to: evil.ts`.

## Cause

`extractFilePathsFromPatch` (`validateToolUse.ts:87`) collected only the `Add File`, `Delete File` and `Update File`
paths, so the per-path `fileRegex` loop never saw the move destination. `ApplyPatchTool.saveMovedFile` checks
`.rooignore`, protected files and workspace bounds, not the mode's regex.

## Fix

`*** Move to: ` joins `PATCH_FILE_MARKERS`, so the destination goes through the same regex check as every other
patch path.

## Tests

`validateToolUse.spec.ts` refuses an `Update File: a.md` + `Move to: evil.ts` patch in a `\.md$` mode with
`Got: evil.ts`. Mutation: with the marker removed again the case goes red; restored, 45/45 pass.
