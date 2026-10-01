# Plan: Fix silent file-save loss in `DiffViewProvider.saveChanges()`

## Context

The user reported that some edited or newly created files end up not being saved to disk after the recent fixes that "prevent excessive reset on streaming" — commits [3b466d73e](src/integrations/editor/DiffViewProvider.ts) (encapsulate state in `ActiveEdit` + `isStale`) and 5720efa1f (committed plan only — no code change).

### Root cause (verified by reading code)

`DiffViewProvider.saveChanges()` at [src/integrations/editor/DiffViewProvider.ts:227-336](src/integrations/editor/DiffViewProvider.ts#L227-L336) silently drops the write when `activeEdit` is `null`:

```ts
// L235-238
const edit = this.activeEdit
if (!edit || edit.newContent === undefined) {
	return { newProblemsMessage: undefined, userEdits: undefined, finalContent: undefined }
}
```

`reset()` at [DiffViewProvider.ts:644-658](src/integrations/editor/DiffViewProvider.ts#L644-L658) atomically nulls `activeEdit` and flips `edit.isStale = true`. `resetStreamingState()` at [src/core/task/TaskStreamProcessor.ts:162](src/core/task/TaskStreamProcessor.ts#L162) awaits that `reset()` at the start of every new API request.

`WriteToFileTool.execute()` at [src/core/tools/WriteToFileTool.ts:99-194](src/core/tools/WriteToFileTool.ts#L99-L194) sequence is `open() → update() → askApproval() → saveChanges() → reset()` (same shape in apply_diff / insert_content / search_and_replace). When an external `reset()` fires between `askApproval` (L162) and `saveChanges` (L169), or mid-`saveChanges` after any of its `await`s, the user-approved content is silently discarded:

- The early return at L236 hides the failure with no log.
- `pushToolWriteResult` (L178) reports a "successful" but empty result.
- The file is never persisted to disk.

`update()` already does the right thing (captures `edit` once, re-checks `isStale` after every `await` at L178/199/219) — `saveChanges()` does not. Additionally, the "best-effort stranded-document flush" referenced in commit 5720efa1f's message was never actually implemented; that commit's diff only added a planning markdown file.

### Goal

Once the user has approved a change, the buffered content **must** reach disk regardless of whether the diff editor was torn down by a concurrent `reset()`. Surface the recovery path with a `console.warn` so the regression is visible if it recurs.

---

## Approach

Cache `pendingSave: { relPath, newContent }` on the `DiffViewProvider` instance, published by `update()` once `isFinal=true`, drained by `saveChanges()`/`saveDirectly()`, cleared by `revertChanges()` and defensively by `open()`. The buffer is **deliberately preserved across `reset()`** — that's what makes recovery possible. `saveChanges()` becomes: try the diff-editor save path; on entry-time or post-`await` staleness, fall back to a direct `fs.writeFile` of `pendingSave.newContent`.

This contains the recovery entirely inside `DiffViewProvider` — no caller (`WriteToFileTool`, etc.) changes.

---

## Changes

### 1. `src/integrations/editor/DiffViewProvider.ts`

**1a. New private field** (near `lastEditedRelPath`, ~L54)

```ts
/**
 * Snapshot of the most recently buffered final content + path, published by
 * update() once isFinal=true. Drained by saveChanges() / saveDirectly() and
 * cleared by revertChanges() / open(). Outlives activeEdit so a reset() that
 * races between approval and saveChanges cannot drop an approved write.
 */
private pendingSave?: { relPath: string; newContent: string }
```

**1b. Publish from `update()`** — inside the `if (isFinal)` block, after the `hasEmptyLastLine` adjustment (~L207), set `this.pendingSave = { relPath: edit.relPath, newContent: accumulatedContent }`. Place it after the trim/EOL adjustment so the buffer matches exactly the bytes the user is asked to approve. Do not publish on partial updates — only after isFinal completes its applyEdit.

**1c. Rewrite `saveChanges()` (L227-336):**

1. Snapshot both at entry: `const edit = this.activeEdit; const pending = this.pendingSave;`
2. Capture `const fallbackPreDiagnostics = edit?.preDiagnostics ?? vscode.languages.getDiagnostics()` once at entry (used by recovery branch).
3. Hard guard: if `!edit?.newContent && !pending` → return existing empty tuple (genuine "nothing to save" — open() never finalized).
4. Set `this.lastEditedRelPath = edit?.relPath ?? pending!.relPath` early so `pushToolWriteResult` always has a path.
5. **Editor branch** — if `edit && edit.newContent !== undefined && !edit.isStale`: run the existing flow (`updatedDocument.save()`, `showTextDocument`, `closeAllDiffViews`, `delay`, diagnostics, EOL normalization, userEdits diff). After **each** `await`, re-test `edit.isStale`; if it flips, fall through to the recovery branch with `pending` as the source.
6. **Recovery branch** — when `edit` is missing/stale and `pending` is set:
    - `console.warn("[DiffViewProvider] saveChanges: diff session went stale before save completed; flushing approved content directly to disk for ${pending.relPath}")`
    - `await createDirectoriesForFile(path.resolve(this.cwd, pending.relPath))`
    - `await fs.writeFile(absolutePath, pending.newContent, "utf-8")`
    - Run the same diagnostics block `saveDirectly()` already uses, seeded with `fallbackPreDiagnostics`.
    - Set `this.userEdits = undefined; this.newProblemsMessage = newProblemsMessage`.
    - Return `{ newProblemsMessage, userEdits: undefined, finalContent: pending.newContent }`.
7. Drain on success: `this.pendingSave = undefined` immediately before each `return`.

Notes: do NOT call `closeAllDiffViews()` on the recovery branch (`reset()` already did that). Do NOT call `showTextDocument` with `edit.diffEditor` on the recovery branch — the handle may be invalid.

**1d. `reset()` (L644-658)** — leave behavior as-is, add a comment explaining `pendingSave` is intentionally preserved:

```ts
// NOTE: pendingSave is intentionally NOT cleared here. saveChanges()
// drains it; revertChanges() / open() clear it. Preserving across reset()
// is what allows saveChanges to recover an already-approved write when
// resetStreamingState() races with the tool execution.
```

**1e. `revertChanges()` (~L399-450)** — set `this.pendingSave = undefined` before/after the inner `await this.reset()` call. The user explicitly rejected, so the buffer must be discarded.

**1f. `saveDirectly()` (~L669)** — after the successful `fs.writeFile` (L688), `this.pendingSave = undefined`. Defensive clear; preventFocusDisruption path doesn't populate it but a stale buffer from a prior diff session must not survive a switch to direct mode.

**1g. `open()` (~L66)** — at the top, alongside `this.isEditing = true`, set `this.pendingSave = undefined`. Protects against a path that left the buffer set without a save (exception between `update` and `askApproval`).

### 2. `src/integrations/editor/__tests__/DiffViewProvider.race.spec.ts`

Existing mocks already cover `fs/promises.writeFile`, `path.resolve`, and `createDirectoriesForFile`. Add helper `installPendingSave(provider, relPath, content)` and `vi.spyOn(console, "warn").mockImplementation(() => {})` in `beforeEach` (restore in `afterEach`).

New tests:

1. **`saveChanges() flushes pendingSave to disk after reset() nulls activeEdit`** — install fake session + pendingSave, `await reset()`, then `await saveChanges(false, 0)`. Assert: `fs.writeFile` called with the buffered path/content; `result.finalContent` matches; `result.userEdits === undefined`; `pendingSave` drained; `lastEditedRelPath` set; `console.warn` fired once.

2. **`saveChanges() recovers when reset() fires after the first await`** — start `saveChanges()` without awaiting, let it reach the first await via `await Promise.resolve()` ticks, call `await reset()`, resolve the deferred document.save, await result. Assert recovery branch ran (`fs.writeFile` called with buffered content; `pendingSave` drained).

3. **`saveChanges() returns empty tuple when neither activeEdit nor pendingSave is set`** — fresh provider. Assert empty tuple, no `fs.writeFile`, no `console.warn`. Pins existing no-op behavior.

4. **`revertChanges() clears pendingSave`** — install pendingSave + fake session, await `revertChanges()`. Assert `pendingSave === undefined`; `fs.writeFile` not called.

5. **`reset() preserves pendingSave`** — install both, await `reset()`. Assert `activeEdit === undefined`; `pendingSave` deeply equals original.

6. **`open() clears stale pendingSave`** — set pendingSave; invoke `open()` synchronously (don't await). Assert `pendingSave === undefined` synchronously after the call (the clear runs before the first await).

---

## Critical files

- [src/integrations/editor/DiffViewProvider.ts](src/integrations/editor/DiffViewProvider.ts) — all production changes
- [src/integrations/editor/**tests**/DiffViewProvider.race.spec.ts](src/integrations/editor/__tests__/DiffViewProvider.race.spec.ts) — new test cases
- [src/integrations/editor/**tests**/DiffViewProvider.spec.ts](src/integrations/editor/__tests__/DiffViewProvider.spec.ts) — read-only reference; existing tests should continue to pass unchanged
- [src/core/task/TaskStreamProcessor.ts](src/core/task/TaskStreamProcessor.ts) — read-only; the trigger of `reset()` lives at L162 but no change needed
- [src/core/tools/WriteToFileTool.ts](src/core/tools/WriteToFileTool.ts) — read-only; callers stay unchanged

Reused utilities (already imported in `DiffViewProvider.ts`):

- `createDirectoriesForFile` from `../../utils/fs`
- `fs.writeFile` from `fs/promises`
- `path.resolve`
- `vscode.languages.getDiagnostics`

The fallback fs-write block mirrors the existing pattern in `saveDirectly()` ([DiffViewProvider.ts:669+](src/integrations/editor/DiffViewProvider.ts#L669)) — same diagnostics flow, same delay handling.

---

## Verification

**Unit tests**

```bash
cd /home/krzych/Projekty/QUB-IT/Roo-Code
pnpm vitest run src/integrations/editor/__tests__/DiffViewProvider.race.spec.ts
pnpm vitest run src/integrations/editor/__tests__/DiffViewProvider.spec.ts
```

All tests pass; the six new race-recovery cases above turn green.

**Manual end-to-end**

1. Build & launch the dev VSIX in VS Code; open a real workspace.
2. **Happy path regression**: have Roo do a `write_to_file` and approve normally. Confirm the file is written and the tool result reports the path. (No `pendingSave` warning expected.)
3. **Race trigger**:
    - Set a long `writeDelayMs` (e.g. 5000ms) to widen the window, OR
    - As soon as the diff appears and you click Approve, immediately close the diff editor tab manually. VS Code disposes the editor; the next `await` in `saveChanges` resolves, the `isStale` check flips, the recovery branch fires.
4. `cat` the target file: approved content **must** be present.
5. Roo Output channel: exactly one `[DiffViewProvider] saveChanges: ... flushing approved content directly to disk for <path>` warning per recovery event.
6. **Reject path**: trigger the same write and click Reject. Confirm no warning, no file written, and the next unrelated write proceeds cleanly (no leakage from `pendingSave`).
7. **`preventFocusDisruption` regression**: enable that experiment, redo step 2. `saveDirectly` works; no `pendingSave` warnings.
