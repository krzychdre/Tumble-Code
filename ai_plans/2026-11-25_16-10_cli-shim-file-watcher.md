# The CLI watches files like VS Code

Status: done, merged as #1375.

## Problem

The owner wants code indexing in the CLI as in VS Code. The index keeps itself current through
`vscode.workspace.createFileSystemWatcher` (`src/services/code-index/processors/file-watcher.ts`), and so do the file
context tracker, `.rooignore`, custom modes, skills, MCP config, the plan review panel and the workspace tracker.
The CLI's shim returned a watcher that never fired (`packages/vscode-shim/src/api/WorkspaceAPI.ts`), so none of them
noticed a change during a CLI session.

## Fix

`createFileSystemWatcher` watches with chokidar (new dependency of the shim, bundled into the CLI with it):

- the base and pattern come from a relative pattern (base as a path, Uri or workspace folder), a relative string
  pattern (from the workspace folder) or an absolute string (from its last directory without a glob character);
- a pattern without a glob character watches that one file (also before it exists); a glob watches the base
  recursively and reports what `path.matchesGlob` matches;
- `node_modules` and `.git` are never watched (VS Code's default `files.watcherExclude`);
- the ignore-create/change/delete flags are honoured; an `error` (inotify limit, vanished base) is logged.

## Tests

`packages/vscode-shim/src/__tests__/WorkspaceAPI.test.ts`: real files in a temp dir (create, change, delete, glob
filter, node_modules, one file before it exists, ignore flags); mutation-checked (an extra path comparison for the
one-file case was dropped because chokidar already reports only that file).
