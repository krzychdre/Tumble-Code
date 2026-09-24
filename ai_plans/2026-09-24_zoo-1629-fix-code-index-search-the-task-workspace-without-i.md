# Zoo #1629 port: codebase_search uses the index of the task's workspace

**Status:** ported, one commit on the Zoo port stack.
**Upstream:** Zoo-Code PR #1629, commit `f797477b8` (merged 2026-09-20), author Alexei Gubin.
**Touched:** `src/core/tools/CodebaseSearchTool.ts`,
`src/core/tools/__tests__/codebaseSearchTool.workspace.spec.ts` (new).

## Symptom

In a multi-root workspace, a task running in root B while the active editor shows a file from
root A searches the code index of root A. The model gets results from the wrong project, or a
"not ready" error from an index nobody asked for, although the tool was offered because root B's
index is ready.

## Root cause in our code

`src/core/tools/CodebaseSearchTool.ts:63` called `CodeIndexManager.getInstance(context)` without a
workspace path, although `:25` already computed `workspacePath` from `task.cwd`. Without a path,
`getInstance` (`src/services/code-index/manager.ts:48-67`) resolves the active editor's workspace
folder. `src/core/task/build-tools.ts:133` decides whether to offer the tool with
`getInstance(provider.context, cwd)`, so offering and searching looked at different indexes.

## Fix

Pass `workspacePath` to `getInstance`. When `task.cwd` is outside every workspace folder,
`getInstance` creates an uninitialized manager for that path, so the tool reports that indexing is
not ready instead of silently searching another root.

## Tests

New `codebaseSearchTool.workspace.spec.ts`: task cwd `/second`, active-editor root `/first`. Before
the fix it failed (`getInstance` was called without `"/second"`, so the `/first` index was
searched). After: passes. `src/core/tools` + `src/services/code-index`: 59 files, 1142/1142 tests;
`tsc --noEmit`, eslint and prettier clean.

## Not ported

- The `CodeIndexManagerRegistry` refactor Zoo's code relies on (Zoo #1622, not ported); our
  `getInstance(context, workspacePath)` already has the same lookup semantics.
- Zoo's 468-line general `CodebaseSearchTool.spec.ts` suite: broad coverage unrelated to this bug.
