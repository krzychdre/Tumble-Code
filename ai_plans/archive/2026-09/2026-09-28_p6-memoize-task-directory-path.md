# P6: Memoize `getTaskDirectoryPath` storage-root resolution

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, Priority 3 (performance), P6.
Branch: `feature/p6-memoize-task-directory-path` (off `main` @ `0dda56bb1`).

## Problem (verified on main)

`getTaskDirectoryPath` (`src/utils/storage.ts:53`) delegates to `getStorageBasePath`
(`src/utils/storage.ts:14`), which on **every** task read/save:

1. reads the VS Code config (`vscode.workspace.getConfiguration(...).get("customStoragePath")`),
2. when a custom path is configured: `fs.mkdir(customPath, { recursive: true })` +
   `fs.access(customPath, R_OK|W_OK|X_OK)` — per call,
3. `getTaskDirectoryPath` then `fs.mkdir`s the per-task directory (cheap single
   syscall, recursive no-op when it exists).

`getStorageBasePath` is called from every task-persistence read/write path
(`apiMessages`, `taskMessages`, `taskMetadata`, `TaskHistoryStore.getTasksDir`,
`ArtifactStore.forTask`, message-manager, tools, gateways) — i.e. multiple times
per task turn.

## Design

Memoize the **storage-root resolution** in `getStorageBasePath`, not the
per-task mkdir.

### Cache key

`"${defaultPath}\u0000${customStoragePath}"` — a module-level `Map<string, string>`.

Why both components:

- `defaultPath` (the VS Code globalStorage fsPath) differs per extension host /
  workspace window, so a bare module constant would be wrong across windows.
- `customStoragePath` is re-read from config on every call. Re-reading the config
  is what makes the key self-invalidating: if the user changes the setting at
  runtime, the key changes and the new value is resolved fresh. No config-change
  listener needed.

The empty-config fast path (no custom path → return `defaultPath`, no fs I/O)
is not cached — there is nothing to memoize.

### What is cached / what is not

- **Cached:** only successful resolutions of a custom path (mkdir + access both
  passed). Value = the custom path.
- **NOT cached:** fs failures. On mkdir/access error the entry is simply never
  stored, so the next call retries the fs and re-surfaces the
  `showErrorMessage` fallback — identical observable behavior to today.
- **NOT cached:** the per-task `mkdir` in `getTaskDirectoryPath`.
  `deleteTaskWithId` (`TaskHistoryGateway.ts:560`, `BackgroundTaskRunner.ts:300`)
  `fs.rm`s task directories recursively; caching "dir exists" would return a
  stale path after a delete. Recursive mkdir on an existing dir is one cheap
  syscall, so the win doesn't justify the risk.

### Trade-off accepted (per roadmap instruction)

After a successful resolution the dir is assumed usable for the rest of the
session; if the storage root becomes unavailable later (unmount, chmod), calls
return the cached path and the failure surfaces at the write/read site instead
of falling back to default. This is the documented memoization trade-off; a
config change still re-resolves.

### Test impact

`src/utils/__tests__/storage.spec.ts` re-imports the module per test already
(dynamic imports); the memo is module state, so `vi.resetModules()` is added in
`beforeEach` to keep each test's fs/config spies independent of prior cache
entries.

## Tests (lowest layer — unit, same spec file)

1. Two calls with the same `(defaultPath, customPath)` → `mkdir`/`access` on the
   custom path run **once**; both calls return the custom path; config is still
   read per call.
2. Changed config value → new key → fs runs again for the new path.
3. Different `defaultPath` → new key → fs runs again.
4. fs failure (mkdir throws) → falls back to default, error message shown, and
   the **next** call retries fs (nothing cached) and can succeed.
5. `getTaskDirectoryPath` end-to-end: same root twice → custom-path fs once,
   per-task mkdir still per call (deletion safety).

## Files

- `src/utils/storage.ts` — the memo.
- `src/utils/__tests__/storage.spec.ts` — `vi.resetModules()` + new cases.
- `.changeset/p6-memoize-task-directory-path.md` — patch, performance.
