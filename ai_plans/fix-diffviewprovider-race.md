# Fix: `DiffViewProvider` race condition — architectural refactor

## Context

When the AI agent (Roo Code v3.53.0 inside this fork) tried to overwrite an existing file via `write_to_file`, it crashed with:

```text
TypeError: Cannot read properties of undefined (reading 'clear')
  at DiffViewProvider.update (extension.js:3003:161)
  at async WriteToFileTool.execute (extension.js:4530:984)
```

The agent worked around it once (using `cat << 'EOF'`), but the underlying defect is **systemic**: any tool routed through `DiffViewProvider` (`write_to_file`, `apply_diff`, `apply_patch`, `edit`, `search_and_replace`, `edit_file`) can hit the same crash whenever a fresh API turn (or any of the 17 reset call sites) interleaves with an in-flight diff `update()`.

This refactor fixes the bug class — not just the one reported `.clear()` line.

The original failure trace is preserved at [spotted-errors/file-clear-error-2.md](../spotted-errors/file-clear-error-2.md).

## Root cause

[`DiffViewProvider.update()`](../src/integrations/editor/DiffViewProvider.ts#L119-L194) interleaves three `await vscode.workspace.applyEdit(...)` calls with reads of `this.activeLineController` and `this.fadedOverlayController`. The instance fields are guarded once at line 120, but [`reset()` at lines 619-631](../src/integrations/editor/DiffViewProvider.ts#L619-L631) sets both controllers (and `activeDiffEditor`, `streamedLines`, …) to `undefined` field-by-field. Any concurrent `reset()` while `update()` is awaiting silently nullifies the fields the rest of `update()` will dereference.

The dominant concurrent trigger is [`TaskStreamProcessor.resetStreamingState()` line 162](../src/core/task/TaskStreamProcessor.ts#L162), which calls `await this.access.diffViewProvider.reset()` at the **start of every API turn**. This was introduced in the local refactor `4f87a0de7` ("extract stream processing into TaskStreamProcessor (#9)"). Before that refactor, `reset()` was scoped to the tool that owned the edit; after it, it became a global stream-pipeline cleanup that races every still-in-flight tool update.

The defective shape is generic: 12+ session-scoped fields are mutated in place by both `open()` and `reset()`, and 5+ async methods (`update`, `saveChanges`, `revertChanges`, `scrollToFirstDiff`, `pushToolWriteResult`) deref them across awaits.

## Architectural fix — `ActiveEdit` session capture

Encapsulate **all in-flight session state** in a single immutable-reference object. Asynchronous methods capture that reference once at entry and use the local from then on. `reset()` flips a stale flag on the captured edit and atomically detaches it; in-flight methods finish their work against still-valid local references (or short-circuit on the stale flag where side effects on the closed editor would be wasteful).

This is the standard generation-token / cancellation-snapshot pattern. It is:

- **DRY** — one declaration of session-scoped state, replacing 12 scattered instance fields and the duplicated null-guards.
- **Concurrency-safe by construction** — in-flight ops do not re-read shared state across awaits; they cannot crash on `reset()`.
- **Forward-compatible** — adding a new session-scoped field is one line on the struct, automatically captured everywhere.
- **API-preserving** — the externally-mutated public fields (`editType`, `originalContent`, `isEditing`, `newProblemsMessage`, `userEdits`) stay on the class. They are session-config and tool-output, not in-flight transient state, and they are read/written by 6+ tool files which do not need to change.

### Critical files to modify

- [src/integrations/editor/DiffViewProvider.ts](../src/integrations/editor/DiffViewProvider.ts) — the entire refactor lives here.

### Critical files to read (no modification, callers verified compatible)

- [src/core/tools/WriteToFileTool.ts](../src/core/tools/WriteToFileTool.ts) — uses `editType`, `originalContent`, `isEditing`, `open`, `update`, `saveChanges`, `revertChanges`, `scrollToFirstDiff`, `reset`, `pushToolWriteResult`, `saveDirectly`. All API-stable under this refactor.
- [src/core/tools/EditFileTool.ts](../src/core/tools/EditFileTool.ts), [src/core/tools/ApplyDiffTool.ts](../src/core/tools/ApplyDiffTool.ts), [src/core/tools/ApplyPatchTool.ts](../src/core/tools/ApplyPatchTool.ts), [src/core/tools/EditTool.ts](../src/core/tools/EditTool.ts), [src/core/tools/SearchReplaceTool.ts](../src/core/tools/SearchReplaceTool.ts) — same surface; no change required.
- [src/core/task/TaskStreamProcessor.ts:162](../src/core/task/TaskStreamProcessor.ts#L162) — the start-of-turn reset is preserved as-is (its semantics are now correct under the fix).

### The new internal type

Inside `DiffViewProvider.ts`, introduce a private interface owned by the class:

```ts
interface ActiveEdit {
	readonly id: number
	readonly relPath: string
	readonly diffEditor: vscode.TextEditor
	readonly fadedOverlay: DecorationController
	readonly activeLine: DecorationController
	readonly preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][]
	readonly documentWasOpen: boolean
	readonly createdDirs: string[]
	streamedLines: string[]
	newContent?: string
	isStale: boolean
}
```

Replace the existing private fields (`relPath`, `newContent`, `activeDiffEditor`, `fadedOverlayController`, `activeLineController`, `streamedLines`, `preDiagnostics`, `createdDirs`, `documentWasOpen`) with a single `private activeEdit?: ActiveEdit` plus `private nextEditId = 0`.

### Method-by-method changes

1. **`open(relPath)`** — perform the existing setup against locals, then build the `ActiveEdit` once and assign atomically:

    ```ts
    this.activeEdit = {
    	id: ++this.nextEditId,
    	relPath,
    	diffEditor,
    	fadedOverlay: new DecorationController("fadedOverlay", diffEditor),
    	activeLine: new DecorationController("activeLine", diffEditor),
    	preDiagnostics,
    	documentWasOpen,
    	createdDirs,
    	streamedLines: [],
    	isStale: false,
    }
    this.isEditing = true
    ```

    `fadedOverlay.addLines(...)` and the initial scroll run against the local `diffEditor`, before assignment.

2. **`update(accumulatedContent, isFinal)`** — capture once, then never read `this.activeEdit` again:

    ```ts
    const edit = this.activeEdit
    if (!edit) throw new Error("Required values not set")

    edit.newContent = accumulatedContent
    // ...build edits, await applyEdit...

    if (edit.isStale) return // reset() detached this session

    edit.activeLine.setActiveLine(endLine)
    edit.fadedOverlay.updateOverlayAfterLine(endLine, document.lineCount)
    // ...

    if (isFinal) {
    	// ...applyEdit...
    	if (edit.isStale) return
    	edit.fadedOverlay.clear()
    	edit.activeLine.clear()
    }
    ```

    Place an `if (edit.isStale) return` check after each `await vscode.workspace.applyEdit(...)`. This is the **only** place the staleness check is required — every other field access is already on the captured local and therefore safe.

3. **`saveChanges`, `revertChanges`, `scrollToFirstDiff`, `pushToolWriteResult`** — apply the same `const edit = this.activeEdit; if (!edit) return …` pattern at entry; use `edit.diffEditor`, `edit.relPath`, `edit.streamedLines`, `edit.preDiagnostics`, `edit.createdDirs`, `edit.documentWasOpen` throughout. Drop the per-method `this.activeDiffEditor`/`this.relPath` re-reads; this collapses several existing duplicated null-guards (DRY).

4. **`reset()`** — atomic detach + stale-flag, followed by the existing diff-view teardown:

    ```ts
    async reset() {
      const edit = this.activeEdit
      this.activeEdit = undefined
      this.isEditing = false
      this.editType = undefined
      this.originalContent = undefined
      if (edit) {
        edit.isStale = true
      }
      await this.closeAllDiffViews()
    }
    ```

    The flag is set **after** detaching so any in-flight method that captured the `edit` reference still sees `isStale === true` after its await resumes. `isStale` is the only mutable field on `ActiveEdit` that `reset()` touches; everything else is `readonly`, which is the architectural guarantee.

5. **`saveDirectly()`** — leaves the diff-view path entirely; it doesn't use `activeEdit` and stays untouched.

### What this DRYs up

- Eliminates the four near-identical `if (!this.relPath || !this.activeDiffEditor || …) return` guards currently spread across `update`, `saveChanges`, `revertChanges`, `scrollToFirstDiff`. They collapse to `const edit = this.activeEdit; if (!edit) …`.
- Eliminates the field-by-field nulling block in `reset()` (lines 621-630). One assignment.
- Eliminates the implicit "did anyone call `open()` first?" precondition by making the session presence explicit and type-checked.

### Why not the alternatives

- **Snapshot-locals only inside `update()`** — patches one symptom, leaves the same race surface in `saveChanges`/`revertChanges`/`scrollToFirstDiff`. Not architectural.
- **Optional chaining (`?.clear()`)** — silently produces inconsistent visual state (some edits land, decorations don't); hides the race rather than handling it.
- **Promise-mutex serializing `update()` and `reset()`** — blocks start-of-turn cleanup behind a stuck previous-turn update; risks deadlock through the 17 reset call sites. The capture-and-flag pattern lets `reset()` proceed immediately while in-flight work self-aborts, which is the correct semantics for cancellation.

## Verification

1. **Static** — from repo root: `pnpm -w typecheck` and `pnpm -w lint`. The refactor is purely internal to `DiffViewProvider.ts`; no public types change.
2. **Existing tests** — run `pnpm --filter @roo-code/extension test -- DiffViewProvider`, plus the tool specs that use the provider:

    ```sh
    pnpm --filter @roo-code/extension test -- editFileTool writeToFileTool applyDiffTool applyPatchTool searchReplaceTool
    ```

    None should regress; public API is preserved.

3. **New unit test** in [src/integrations/editor/**tests**/](../src/integrations/editor/__tests__/) named `DiffViewProvider.race.spec.ts`:
    - Mock `vscode.workspace.applyEdit` to return a manually-controlled `Deferred<boolean>`.
    - `await provider.open("foo.ts")`, then start `provider.update("contents", true)` without awaiting.
    - Call `await provider.reset()` while the deferred is pending.
    - Resolve the deferred and `await` the `update()` promise.
    - Assert: no throw; `DecorationController.clear` was **not** called after `reset()` (use spies); a subsequent `provider.open(...)` succeeds.
4. **Manual repro** — re-run the original failing scenario from [spotted-errors/file-clear-error-2.md](../spotted-errors/file-clear-error-2.md): ask the in-tree Roo Code build to overwrite `self-hosted-cloudapi/pyproject.toml` with the PEP 621 conversion. Pre-fix this throws intermittently; post-fix it completes deterministically. Verify the dev console (Help → Toggle Developer Tools → Console) shows no `Cannot read properties of undefined` errors during heavy back-to-back tool turns.

## Out of scope

- The user-application issue from the same transcript (Poetry vs. PEP 621 / `uv` in `self-hosted-cloudapi/pyproject.toml`) is a separate, app-level fix the agent was attempting when this defect interrupted it. Not part of this plan.
- Tightening `editType` / `originalContent` from public mutable fields into a typed init-args object on `open()` would further reduce coupling but requires touching 6+ tool files. Defer as a follow-up if desired.
- Eliminating the start-of-turn `diffViewProvider.reset()` from `TaskStreamProcessor` (in favour of strictly tool-owned lifecycle) — also a follow-up; the current refactor makes it correct, so no urgency.
