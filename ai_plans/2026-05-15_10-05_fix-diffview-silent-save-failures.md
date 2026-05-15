# DiffView silent save failures — investigation & fix

**Status:** Done (2026-05-15)
**Related plans:** `2026-05-14_17-04_error_while_saving_file.md`, `2026-05-10_09-21_fix-unsaved-files-at-end-of-edit.md`
**Touched:**

- `src/integrations/editor/DiffViewProvider.ts`
- `src/integrations/editor/__tests__/DiffViewProvider.race.spec.ts`

## Symptoms

Two distinct user-visible failures during `write_to_file` against `mapper.yml` (new file, openai provider, local GLM-5.1 model):

1. **Loud failure:** Diff editor showed the content, user pressed Ctrl+S to save manually. Roo then threw `Error writing file: No file path available in DiffViewProvider` from `DiffViewProvider.ts:482` and the tool result reached the user as an error blob.
2. **Silent failure (recurrence after fix #1):** Same flow, but no error anywhere — not in Roo's UI, not in the VS Code dev console. The file simply didn't end up with the content Roo claimed to have written. User again had to Ctrl+S to get the bytes to disk.

## What was happening

The DiffView lifecycle is: `open()` → `update(...isFinal=false)*` → `update(...isFinal=true)` → `askApproval()` → `saveChanges()` → `pushToolWriteResult()`. Each tool (`WriteToFileTool`, `EditFileTool`, etc.) drives this sequence. The prior fix `#18` (`09739193c`) added a `pendingSave` recovery buffer published at the **tail** of `update(isFinal=true)` and a recovery branch at the entry of `saveChanges()` that calls `flushPendingSaveDirectly()` (an `fs.writeFile`-based path) when `activeEdit` is missing/stale.

`#18` closed two race windows but missed three more failure modes. All three were addressed in this change.

### Mode A — `reset()` racing INSIDE `update(isFinal=true)`

`update(isFinal=true)` performs up to three sequential `await vscode.workspace.applyEdit(...)` calls (partial replace, optional trim, final replace), each followed by `if (edit.isStale) return`. `pendingSave` was published only **after** the final stale-check.

If `TaskStreamProcessor.resetStreamingState()` fired `diffViewProvider.reset()` during any of those awaits, `isStale` flipped between the `applyEdit` and the check, and `update()` bailed out **before reaching the publication site**. `pendingSave` stayed undefined, `activeEdit` was nulled by reset, and `saveChanges()` took its "genuinely nothing to save" early-return at `DiffViewProvider.ts:254-257` without setting `lastEditedRelPath`. `pushToolWriteResult()` then threw `"No file path available in DiffViewProvider"` — symptom #1.

**Fix:** Hoist the EOL adjustment and the `pendingSave` publication to the very top of the `isFinal` branch, **before any await**. Even a bail at the earliest stale-check now leaves the approved bytes in the recovery buffer for `flushPendingSaveDirectly()` to write through.

### Mode B — `updatedDocument.save()` silently returning `false`

`saveChanges()`'s editor branch awaited `updatedDocument.save()` and discarded its return value:

```ts
if (updatedDocument.isDirty) {
	await updatedDocument.save()
	const recovered = await recoverIfStale()
	if (recovered) return recovered
}
```

VS Code's `TextDocument.save()` returns `Thenable<boolean>`; `false` signals a silent refusal (read-only document, disposed buffer, OS-level file lock, internal VS Code error). The code below then drained `pendingSave` at `DiffViewProvider.ts:385` under the comment "Editor save succeeded" and reported success up the stack. No exception, no log, no bytes on disk. Symptom #2.

The Ctrl+S evidence pins the diagnosis: the buffer had the approved content (the user could save it manually) but Roo's `save()` call refused. Most plausible trigger on the streaming local-model path: the diff editor's modified-side document gets disposed between `update(isFinal=true)` and `saveChanges()` while VS Code is tearing down adjacent diff views, and `save()` on a disposed document returns `false` instead of throwing.

**Fix:** Capture `save()`'s return value, treat `false` symmetrically with a stale-session detach, and fall through to `flushPendingSaveDirectly()`. Emit a `console.warn` so the refusal is observable next time it fires.

### Mode C — `isDirty === false` skipping `save()` entirely

The same editor branch wrapped `save()` in `if (updatedDocument.isDirty)`. If autosave fired between `update(isFinal=true)` and the user clicking Approve — or if the user manually reverted the diff editor — `isDirty` was `false` at `saveChanges()` time, `save()` was skipped entirely, `pendingSave` was drained, and success was reported. But disk could hold autosave's pre-edit/intermediate state, not the approved bytes.

**Fix:** When `isDirty === false` AND `pendingSave` is populated, route through `flushPendingSaveDirectly()`. The function is idempotent — rewriting bytes autosave already wrote is harmless; writing correct bytes when autosave wrote the wrong ones is the whole point.

## Failure surface (before/after)

| Race window                                           | Before this change                             | After this change                                |
| ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `reset()` between `askApproval()` and `saveChanges()` | Recovery (fixed in #18)                        | Recovery (unchanged)                             |
| `reset()` during `saveChanges()` awaits               | Recovery via `recoverIfStale()` (fixed in #18) | Recovery (unchanged)                             |
| `reset()` during `update(isFinal=true)` awaits        | **Throws "No file path available"**            | Recovery via early `pendingSave`                 |
| `save()` returns `false`                              | **Silent no-save, reports success**            | Recovery via `flushPendingSaveDirectly()` + warn |
| `isDirty === false` (autosave / manual revert)        | **Silent skip, reports success**               | Recovery via `flushPendingSaveDirectly()`        |

## Tests

Three new regression tests in `DiffViewProvider.race.spec.ts`:

1. `update(isFinal=true) racing reset() during its first applyEdit still buffers approved bytes for recovery` — arms the partial-replace `applyEdit` with a deferred, fires `reset()` mid-await, asserts `pendingSave` survives and `saveChanges()` writes through via `fs.writeFile`.
2. `saveChanges() recovers when updatedDocument.save() returns false (silent VSCode refusal)` — arms `save()` to return `false`, asserts the fallback path runs and the recovery warning fires.
3. `saveChanges() writes through pendingSave when document is not dirty but buffer is queued` — sets `isDirty=false`, asserts `save()` is never called but `fs.writeFile` still receives the approved bytes.

All three were written before the fix (TDD), confirmed red against the pre-fix code, then passed after the patch.

## Observability hook

A new `console.warn` at the editor-branch fallback exposes the `save() === false` mode in dev tools:

```
[DiffViewProvider] saveChanges: editor save() returned false for <relPath>; falling back to direct disk write
```

If symptom #2 recurs and this warning is **absent**, the silent failure has a different cause and Mode B/C are ruled out. If it's **present**, we know `save()` is being refused and can dig into why (most likely path: document disposal during diff teardown).
