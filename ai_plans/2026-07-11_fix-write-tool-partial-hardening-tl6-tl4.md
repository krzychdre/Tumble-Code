# Fix: Write Tool Partial Hardening (TL-6, TL-4)

**Branch:** `fix/write-tool-partial-hardening`
**Date:** 2026-07-11

## TL-6 [med, SECURITY: info disclosure] — handlePartial opens diff editor before path validation

### Problem

`WriteToFileTool.handlePartial` called `diffViewProvider.open(relPath!)` during
streaming as soon as the path stabilized, with NO `rooIgnoreController.validateAccess`
check and NO outside-workspace check. A weak/manipulated model streaming
`"../../../etc/passwd"` or a roo-ignored secrets file would cause the file's
content to be read and shown in the diff view BEFORE any access control.

### Fix

In `handlePartial`, before the diff editor open section:

1. Validate access via `task.rooIgnoreController.validateAccess(relPath!)` —
   if denied, return quietly (no error spam in partial phase; `execute()` will
   produce the proper structured roo-ignore error in the final phase).
2. Check `isPathOutsideWorkspace(absolutePath)` — if outside, skip opening
   (defer to execute's approval flow; outside-workspace writes may be legitimate
   with approval, so no hard error in partial).
3. Memoize the last-validated path + result (`lastValidatedPartialPath`,
   `lastPartialAccessAllowed`) so repeated chunks for the same rejected path
   don't re-validate. Reset in `resetPartialState()`.

### EditFileTool precedent

`EditFileTool.handlePartial` never opens the diff editor — it only sends a
`task.ask("tool", ...)` preview message. So it doesn't have this disclosure
vector. The WriteToFileTool fix follows the same "partial phase is preview-only,
defer to execute for real operations" principle, but since WriteToFileTool
DOES open the editor in partial, the access guard is placed before that open.

## TL-4 [med] — handlePartial error leaves diff editor open

### Problem

In `BaseTool.handle()`, if `handlePartial` threw AFTER `diffViewProvider.open()`
succeeded but during `update()`, the central catch called `handleError` but never
`diffViewProvider.reset()` — the editor stayed open with `isEditing=true` until
the next turn's `resetStreamingState`.

### Fix

In the partial-phase catch in `BaseTool.handle()`, after `handleError`, call
`await task.diffViewProvider.reset()` guarded by try/catch so a reset failure
can't mask the original error.

## Files changed

- `src/core/tools/WriteToFileTool.ts` — TL-6: access validation + outside-workspace
  guard in `handlePartial`, memo fields, `resetPartialState` override.
- `src/core/tools/BaseTool.ts` — TL-4: `diffViewProvider.reset()` in partial catch.
- `src/core/tools/__tests__/writeToFileTool.spec.ts` — 4 new TL-6 tests.
- `src/core/tools/__tests__/baseTool.spec.ts` — 2 new TL-4 tests (new file).

## Tests

- TL-6: roo-ignored path → open NOT called; outside-workspace → open NOT called;
  valid path → open called (control); repeated rejected chunks → no re-validation.
- TL-4: handlePartial throws → reset called; handlePartial succeeds → reset NOT called.
- All 541 tool tests pass. Typecheck: 0 new errors (pre-existing zai.ts:129 only).
