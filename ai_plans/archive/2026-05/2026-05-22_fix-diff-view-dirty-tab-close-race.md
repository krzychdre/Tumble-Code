# Fix: diff tab still open + unsaved after save — #23 did not actually fix it

**Date:** 2026-05-22
**Branch:** `fix/diff-view-dirty-tab-close-race`
**Status:** Done (2026-05-22) — 30 DiffViewProvider specs + 63 write/edit tool specs pass; `tsc --noEmit` and `eslint --max-warnings=0` clean.
**Supersedes the close logic of:** `2026-05-22_fix-diff-view-stays-dirty-after-save.md` (commit `6dbacc141`, PR #23)
**Related plans:** `2026-05-15_10-05_fix-diffview-silent-save-failures.md`, `fix-diffviewprovider-race.md`

## 1. Symptom (verbatim)

> "Despite correction I still have this situation where roo edits and saves the
> file but it stays open on vscode view and has unsaved marker. It should be
> closed as soon as it has been saved by Roo."

Reproduction reported: a `write_to_file` whole-file write; the diff tab shows
`+76 −0` on a 76-line file (whole file rendered as added — the diff's original
side is empty, i.e. a _new file_ session, `originalContent === ""`); content is
already correct on disk; the tab stays open carrying VS Code's unsaved marker.
Environment: freshly built extension (commit `6dbacc141` / #23 present), VS Code
Auto Save **off**, symptom is **consistent** (not a rare race).

## 2. Why #23 could not have fixed it (proven)

Fix #23 replaced the old `!tab.isDirty` filter in `closeAllDiffViews()` with
`isRooDiffTab()` + `closeDiffTab()`. `closeDiffTab()`
(`DiffViewProvider.ts:674-704`) does, for a dirty Roo diff tab:

1. revert the modified document to on-disk content **only when
   `document.isDirty` is true** (gate at line 682), then
2. `await vscode.window.tabGroups.close(tab)` (line 700).

The #23 commit message itself states the normal-path failure mechanism:

> "saveChanges(): document.save() resolves before VS Code clears the tab's
> dirty flag, so the close can still observe isDirty === true."

That asserts a window where **`tab.isDirty === true` while
`document.isDirty === false`**. But `saveChanges()` calls
`updatedDocument.save()` (line 318) **before** `closeAllDiffViews()` (line 338),
so by the time `closeDiffTab()` runs on the normal path `document.isDirty` is
**already false** — the revert at line 682 is **skipped** — and `close()` is
fired once at a tab VS Code still believes is dirty. `closeDiffTab()`'s own doc
comment admits this is fatal: _"A direct close() on a dirty tab would pop VS
Code's 'save / don't save' dialog."_ In practice VS Code resolves that
`close()` to `false` and the tab is left orphaned.

**The contradiction:** #23 diagnosed "the tab's dirty flag lags the document's
save," then gated its dirty-clearing revert on `document.isDirty` — which is
false during exactly that lag — and closed on the very next line without
waiting for the flag. The fix recreated the race it set out to remove. Net
result: #23 changed normal-`saveChanges()`-path behaviour in **zero**
scenarios. It only helps `flushPendingSaveDirectly()`, where `fs.writeFile`
leaves `document.isDirty === true` so the revert genuinely runs — a narrow
recovery race, not the user's everyday edit.

**Test evidence:** every #23 test mocks `tabGroups.close` to unconditionally
return `Promise.resolve(true)` — none model VS Code refusing a dirty tab. A new
test that does model it (`close()` returns `false` while `Tab.isDirty` is
stale-true, flips false a tick later) fails against `6dbacc141`: `closeDiffTab`
calls `close()` once, it is refused, the tab stays open. RED reproduced.

## 3. Proven root cause

`closeDiffTab()` issues a single `tabGroups.close(tab)` and trusts it. VS Code
refreshes `Tab.isDirty` asynchronously, so a close issued immediately after a
save (or while a document is genuinely dirty) is **refused** (`close()`
resolves `false`) and the diff tab is left open with the unsaved marker. There
is no retry and no re-query after the dirty flag propagates.

## 4. Tech strategy

- **Retry on refusal.** `tabGroups.close()` returns `Thenable<boolean>`; treat
  a falsy result as "refused", yield a turn of the event loop (so VS Code can
  propagate `Tab.isDirty`), re-read the tab fresh, and retry — bounded by a
  small attempt cap. A `true` result is trusted immediately (no re-scan), which
  keeps every existing test green.
- **Keep the genuine-dirty revert.** When the modified document is genuinely
  dirty (recovery path: `fs.writeFile` wrote behind VS Code's back), still
  revert it to on-disk content + `save()` first — disk is authoritative. The
  retry loop then carries the close across the post-save flag lag.
- **Identity guard unchanged.** Only tabs matched by `isRooDiffTab()` are
  touched; foreign dirty tabs keep full protection.
- **Constraints:** internal to `DiffViewProvider.ts`; public API unchanged; no
  new dependencies; all tool callers untouched.

## 5. Blast radius

| Area                                                           | Risk                                        | Mitigation                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `closeDiffTab()` now retries `close()`                         | Could loop on a tab that truly cannot close | Bounded attempt cap; only retries on a falsy `close()` result; logs and gives up best-effort |
| Existing `closeAllDiffViews` tests                             | `close` mocks return `true`                 | A `true` result short-circuits with no re-scan — existing tests unaffected                   |
| Recovery-path test (`flushPendingSaveDirectly`)                | `close` mock returns `true`                 | Same short-circuit; revert still runs for the genuinely-dirty document                       |
| `reset()` / `revertChanges()` callers of `closeAllDiffViews()` | New retry behaviour                         | Idempotent; reduces orphaned tabs, never closes a foreign tab                                |

All production changes are in one file — no shotgun surgery.

## 6. File changes

| Action | File                                                         | Purpose                                                                                                                                                  |
| :----- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD    | `src/integrations/editor/DiffViewProvider.ts`                | `closeDiffTab()` retries a refused `close()` against a freshly-read tab after yielding for the dirty-flag lag; helper `findOpenTab()` re-locates the tab |
| MOD    | `src/integrations/editor/__tests__/DiffViewProvider.spec.ts` | New regression test: a Roo diff tab whose first `close()` is refused (lagging `Tab.isDirty`) is still closed                                             |

## 7. Execution sequence (TDD)

1. **RED** — add the close-refusal regression test; confirm it fails on the
   current code (`closeDiffTab` closes once, tab orphaned). ✅ done.
2. **GREEN** — implement the retry-on-refusal close in `closeDiffTab()`. ✅ done.
3. **VERIFY** — full `DiffViewProvider*` suites + tool suites green;
   `pnpm check-types`; `pnpm lint`. ✅ done.

## 8. Verification standards

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code/src
pnpm vitest run integrations/editor/__tests__/DiffViewProvider.spec.ts \
  integrations/editor/__tests__/DiffViewProvider.race.spec.ts
pnpm vitest run core/tools/__tests__/writeToFileTool core/tools/__tests__/editFileTool
pnpm check-types
pnpm lint
```

- [ ] New close-refusal test red before fix, green after.
- [ ] No regression in `DiffViewProvider` / tool suites.
- [ ] `tsc --noEmit` clean; `eslint` clean (max-warnings=0).

## 9. Manual end-to-end

1. Build the dev VSIX; open a real workspace, Auto Save off.
2. Ask Roo to create a new file and to rewrite an existing file; approve each.
3. Confirm: the diff tab closes immediately after the save, no unsaved marker
   left behind, disk content correct.
4. Repeat rapidly on the same file to exercise the post-save flag lag.
