# MCP write guard per settings file (SVC-8 leftover)

Branch: `fix/svc-8-mcp-write-guard-per-file`

## Symptom

MCP servers are configured in two files: the global MCP settings file and the
project file `.roo/mcp.json`. When the extension itself saved one of them (a
timeout change, a tool toggle, deleting a server), a user's edit of the OTHER
file made within the next 600 ms was silently never loaded: the servers kept
the old configuration until the file was changed again.

## Evidence

- `src/services/mcp/McpConfigStore.ts` (main at 99d28803c): `write()` raised a
  single boolean `writeGuardUp` and lowered it 600 ms (`WRITE_GUARD_MS`) after
  the write ended, whatever file was written; `isWriteGuardUp()` took no path.
- `src/services/mcp/McpConfigWatcher.ts`: `debounce(filePath, source)` returned
  early on `isWriteGuardUp()` for events of both the global and the project
  watch, so the flag set by a global write also dropped project events.
- `src/services/mcp/McpHub.ts`: wired the watcher with
  `() => this.configStore.isWriteGuardUp()`; writers are `updateServerTimeout`,
  `deleteServer` (hub) and the tool-list toggles in `McpToolCatalog`, all via
  `configStore.write(configPath, ...)` for the file of the given source.
- Reproduced by the new McpHub specs on commit 1: after
  `updateServerTimeout("a", 30, "global")`, an external change of the project
  file 100 ms later led to 0 calls of `updateServerConnections` (expected 1,
  with the new project servers); the mirror case failed the same way.

## Root cause

The guard answers "did the store just write?" instead of "did the store just
write THIS file?". Its purpose is to drop the echo of our own write, which can
only ever arrive for the file we wrote.

## Fix

- `McpConfigStore` keeps a map from written path to the timer that lowers its
  guard. `write(filePath)` raises the guard of that file only, restarts its
  600 ms after the write ends; each file has its own clock.
- `isWriteGuardUp(filePath)` matches the path with `arePathsEqual` (the
  watcher reports `uri.fsPath`, which may differ in spelling, for example the
  drive letter case on Windows). Without a path it still answers "any file",
  so the existing store specs keep their meaning.
- `McpConfigWatcher` takes `isWriteGuardUp: (filePath) => boolean` and asks
  about the file whose event it received; `McpHub` passes the path through.
- `dispose()` clears every timer.

Residual: if the watcher ever reported a path that `arePathsEqual` does not
match to the written path (a symlinked workspace, for example), the echo of
our own write would be handled as a user edit. That costs one extra reload of
identical content (the connection diff keeps unchanged servers), never a lost
edit, which is the safer failure.

## Tests

- `McpHub.spec.ts`, "write guard": a global write followed by an external
  project edit reloads the project servers; a project write followed by a
  global edit reloads the global servers while the project echo stays dropped.
- `McpConfigStore.spec.ts`: the guard is up only for the written file, with
  independent clocks; a differently spelled path of the written file matches,
  another file does not.
- `McpConfigWatcher.spec.ts`: the guard callback is asked with the changed
  file's path.
- All `src/services/mcp/**` specs: 8 files, 181 tests green.
