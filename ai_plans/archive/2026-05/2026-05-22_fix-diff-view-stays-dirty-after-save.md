# Fix: diff view stays open & dirty after Roo has saved the file

**Date:** 2026-05-22
**Branch:** `fix/diff-view-stays-dirty-after-save`
**Status:** Done (2026-05-22) — 29 DiffViewProvider specs + 100 tool/editor specs pass; `tsc --noEmit` and `eslint --max-warnings=0` clean.
**Related plans:** `2026-05-15_10-05_fix-diffview-silent-save-failures.md`, `2026-05-10_09-21_fix-unsaved-files-at-end-of-edit.md`, `fix-diffviewprovider-race.md`

## 1. Symptom (verbatim)

> "When Roo is editing a file, it's opened in diff view and seen as unsaved. Then Roo
> saves the file but the diff view (with unsaved-marker) stays open. It is already
> correctly saved by Roo but still VSCode has the diff view open with a broken version."

The file content on disk is correct. The leftover artifact is the **diff editor tab**:
still present, still flagged dirty (the tab dot), still displaying stale content.

## 2. Proven root cause (evidence from source)

The diff tab is a `vscode.TabInputTextDiff` whose **modified side is the real file
document**. Streaming `vscode.workspace.applyEdit()` calls in `update()` make that
document dirty, so the tab reports `tab.isDirty === true`.

`closeAllDiffViews()` — `src/integrations/editor/DiffViewProvider.ts:632-664` — closes a
tab **only when `!tab.isDirty`** (filter at lines 641 and 648). The dirty filter was
introduced in commit `8eb14734` ("resolve diff editor issues with markdown preview
associations") to avoid discarding genuine unsaved user work. It cannot tell apart
"dirty because save has not propagated yet" from "dirty because of real user edits".

Two control-flow paths leave the tab dirty when `closeAllDiffViews()` runs:

- **Recovery path never even tries to close the tab.** `flushPendingSaveDirectly()`
  (`DiffViewProvider.ts:450-509`) is the recovery branch for a stale diff session
  (concurrent `reset()` from `TaskStreamProcessor.resetStreamingState()`,
  `TaskStreamProcessor.ts:162`). It writes the file with `fs.writeFile` at line 466 —
  bytes land correctly — but contains **no `closeAllDiffViews()` call**. `fs.writeFile`
  writes to disk behind VS Code's back, so the in-memory diff document stays dirty.
  Control returns to the tool caller (`WriteToFileTool.ts:186`) which calls `reset()`;
  `reset()` does call `closeAllDiffViews()` (line 843) but the dirty filter skips the
  still-dirty tab. **Tab stays open, dirty, stale — exactly the reported symptom.**

- **Normal path: close races the dirty-flag clearing.** `saveChanges()` line 318
  `updatedDocument.save()` resolves when the write finishes, but VS Code clears the
  _tab's_ `isDirty` flag on a later event-loop turn. `closeAllDiffViews()` at line 338
  can still observe `tab.isDirty === true` and skip the tab.

**Conclusion:** the diff tab can be `isDirty === true` at every call site of
`closeAllDiffViews()` after a save, and `closeAllDiffViews()` unconditionally skips
dirty tabs — so it leaves the just-saved diff tab open, dirty, showing stale content.

## 3. Tech strategy

- **Pattern:** make `closeAllDiffViews()` able to close a Roo-owned diff tab whose
  underlying document still matches disk. The dirty filter must only protect _genuine_
  unsaved work, not a Roo diff buffer that has already been persisted.
- **Mechanism:** before closing a dirty Roo diff tab, revert its modified document to
  its on-disk state via `vscode.workspace.applyEdit` + `document.save()` (idempotent —
  disk already holds the correct bytes), which clears the dirty flag; then close it.
  If that still fails, fall back to closing the dirty tab directly.
- **Identity guard:** only do this for tabs we recognise as Roo diff tabs
  (`original.scheme === DIFF_VIEW_URI_SCHEME` OR label contains `DIFF_VIEW_LABEL_CHANGES`)
  — the exact same predicate the function already uses. A foreign dirty tab is never
  touched.
- **Recovery-path fix:** call `closeAllDiffViews()` inside `flushPendingSaveDirectly()`
  so the recovery branch also tears the tab down instead of leaking it.
- **Constraints:** no new dependencies; internal to `DiffViewProvider.ts`; public API
  unchanged; all six tool callers untouched.

## 4. Blast radius

| Area                                                                         | Risk                                         | Mitigation                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `closeAllDiffViews()` now closes some dirty tabs                             | Could close a tab with real user edits       | Identity guard restricts to Roo diff tabs only; foreign tabs keep the `!isDirty` protection            |
| Existing test `closeAllDiffViews method` asserts dirty Roo tab is NOT closed | Will need updating to new contract           | Update that test to assert the dirty Roo tab IS reverted+closed; foreign dirty tab still skipped       |
| `revertChanges()` also calls `closeAllDiffViews()`                           | Revert flow already saved/handled docs first | Revert reverts the document itself before closing, so tab is clean there; new branch is a no-op for it |
| `reset()` calls `closeAllDiffViews()`                                        | Same new behaviour, intended                 | This is the path that now correctly closes the leftover tab                                            |

No "shotgun surgery": all production changes are in one file.

## 5. File changes

| Action | File                                                              | Purpose                                                                                                                                                                                        |
| :----- | :---------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD    | `src/integrations/editor/DiffViewProvider.ts`                     | New helper `closeDiffTab(tab)` that reverts-then-closes a dirty Roo diff tab; `closeAllDiffViews()` routes dirty Roo tabs through it; `flushPendingSaveDirectly()` calls `closeAllDiffViews()` |
| MOD    | `src/integrations/editor/__tests__/DiffViewProvider.spec.ts`      | Update `closeAllDiffViews` test to the new contract (dirty Roo tab reverted+closed; foreign dirty tab still skipped)                                                                           |
| MOD    | `src/integrations/editor/__tests__/DiffViewProvider.race.spec.ts` | New regression test: `flushPendingSaveDirectly()` closes the diff tab                                                                                                                          |

## 6. Execution sequence (TDD)

1. **RED — recovery-path test.** In `DiffViewProvider.race.spec.ts`, add a test driving
   the stale-session recovery (existing pattern) and asserting `closeAllDiffViews`
   effect: a dirty Roo diff tab is closed during recovery. Watch it fail.
2. **RED — closeAllDiffViews contract test.** In `DiffViewProvider.spec.ts`, update the
   `closeAllDiffViews` test: dirty Roo diff tab MUST be closed (after a revert), foreign
   dirty tab MUST still be skipped, regular file tab MUST still be skipped. Watch it fail.
3. **GREEN — implementation.** Add `closeDiffTab()` helper; route dirty Roo tabs through
   it in `closeAllDiffViews()`; add `await this.closeAllDiffViews()` to
   `flushPendingSaveDirectly()` after the `fs.writeFile`.
4. **VERIFY.** Run both spec files green; run full `DiffViewProvider*` + tool specs for
   regressions; `tsc --noEmit`; `eslint`.

## 7. Verification standards

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src
pnpm vitest run integrations/editor/__tests__/DiffViewProvider.spec.ts \
  integrations/editor/__tests__/DiffViewProvider.race.spec.ts
pnpm vitest run core/tools/__tests__/writeToFileTool core/tools/__tests__/editFileTool
pnpm check-types
pnpm lint
```

- [ ] New recovery-path regression test red before fix, green after.
- [ ] Updated `closeAllDiffViews` test: dirty Roo tab closed, foreign dirty tab skipped.
- [ ] No regression in existing `DiffViewProvider` / tool suites.
- [ ] `tsc --noEmit` clean; `eslint` clean (max-warnings=0).

## 8. Manual end-to-end

1. Build the dev VSIX, open a real workspace.
2. Ask Roo to edit an existing file; approve. Confirm the diff tab closes and no dirty
   tab is left behind; disk content is correct.
3. Widen the race window (large `writeDelayMs`, or close the diff tab during approval)
   to trigger the recovery branch; confirm the tab still ends up closed.
