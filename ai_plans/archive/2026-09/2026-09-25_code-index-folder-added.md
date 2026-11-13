# Code index for workspace folders added after activation (SVC-10 leftover)

Branch: `fix/svc-10-code-index-folder-added`

## Problem (verified on main ca3e0fb0a)

- `src/extension.ts` creates a `CodeIndexManager` for every folder in `vscode.workspace.workspaceFolders`
  at activation and calls `initialize(contextProxy)` on it in the background.
- `onDidChangeWorkspaceFolders` (added in #328) only disposed the managers of REMOVED folders.
- A folder ADDED later got a manager only lazily, from `CodeIndexManager.getInstance` in
  `build-tools.ts`, `CodebaseSearchTool` or `ClineProvider.getCurrentWorkspaceCodeIndexManager`.
  None of these calls `initialize()`, so `_configManager` stays undefined and:
    - `isFeatureEnabled` is false, so `filter-tools-for-mode.ts` hides `codebase_search` for tasks in
      that folder;
    - no scan and no file watcher start;
    - the indexing badge for that folder shows Standby even when indexing is enabled and configured.
      It recovered only when the user saved the index settings or pressed Start/toggled the folder.
- User-visible in multi-root workspaces (adding a folder there does not restart the extension host).

Second defect found on the way: `dispose()` during a running `initialize()` (folder added then removed
quickly, or deactivate during start-up) did not stop `initialize()`. It went on after the awaits, built an
orchestrator and started its FileWatcher on a manager already removed from the instance map: a leaked
watcher nothing would ever dispose.

## Fix

1. `extension.ts`: one `startCodeIndexForFolder(folder)` helper (getInstance + background
   `initialize(contextProxy)` + log on failure) used for the initial folders AND for `event.added`.
   No new gates: `initialize()` already applies the enablement gates (feature enabled, folder enabled),
   so added folders follow exactly the activation behaviour. Managers are no longer pushed one by one
   into `context.subscriptions`; the existing `disposeAll()` subscription covers them all.
2. `manager.ts`: `initialize()` returns early when disposed, and re-checks `_disposed` after each await;
   `_recreateServices()` disposes the freshly created FileWatcher and ignore controller when the manager
   was disposed during embedder validation.

## Tests (test-first)

- `src/__tests__/extension.spec.ts`: added folder gets `getInstance(context, path)` + `initialize(proxy)`
  like the initial one; added+removed in one event disposes the removed one and only logs a failed
  initialize.
- `src/services/code-index/__tests__/manager.spec.ts`: dispose during initialize starts no watcher and
  disposes the services built meanwhile; initialize on a disposed manager is a no-op.

## Out of scope

- `handleSettingsChange()` has the same shape of await-then-act after `loadConfiguration()`; the watcher
  leak there is closed by the `_recreateServices()` guard, the rest is harmless on a dead manager.
