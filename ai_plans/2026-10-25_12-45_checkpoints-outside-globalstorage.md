# Checkpoints move out of globalStorage (2026-10-25)

**Status:** done 2026-10-25, merged as #1144 (`cda718280`).
**Touched:** `src/services/checkpoints/`, `src/core/checkpoints/index.ts`, `src/core/webview/TaskHistoryGateway.ts`,
`src/extension.ts`.

## Why

Opening the extension page in VS Code, or switching its Details/Features/Changelog tabs, froze the whole editor and
starved the desktop of memory. Measured on the owner's machine (2026-10-25):

| What                                       | Measurement                                          |
| ------------------------------------------ | ---------------------------------------------------- |
| Tumble Code extension page, after idle     | 107.2 s CPU in 30 s, peak 451%                       |
| ErrorLens extension page, same conditions  | 4.2 s CPU in 30 s, peak 49%                          |
| Each tab switch on our page                | ~106% CPU for seconds, renderer RSS up to several GB |
| `globalStorage/qub-it.tumble-code`         | 13 GB, 616 028 files and directories                 |
| of which `tasks/*/checkpoints` (636 tasks) | 12.15 GB, ~5 000 files per task                      |
| `globalStorage/eamodio.gitlens` for scale  | 2 entries, 20 MB                                     |

The extension page shows a `Size` field (ours reads "147.04MB"). To produce it VS Code resolves the extension's data
folder recursively. A breakpoint on `doResolveFile` in the workbench bundle caught it walking
`globalStorage/qub-it.tumble-code` and its children on every tab switch. The renderer sends one file request per
entry, the main process answers each with `lstat`, so both burn a core and the renderer's heap grows into gigabytes.

Each task gets its own shadow git repository under `<globalStorage>/tasks/<taskId>/checkpoints`
(`ShadowCheckpointService.create`), which is what makes the folder enormous. Nothing about checkpoints requires them
to live in globalStorage: they are a local cache keyed by task id, not synced state.

## Change

1. Checkpoints live under `~/.roo/checkpoints/<taskId>` (`getGlobalRooDirectory()` already owns `~/.roo`, as
   `worktrees/` and `skills/` do). VS Code never walks that path for the extension page.
2. `CheckpointServiceOptions.shadowDir` becomes `checkpointsRoot`, so the option says what it is instead of naming the
   storage that no longer holds it. `ShadowCheckpointService.create` joins `<checkpointsRoot>/<taskId>`; the extra
   `tasks/` level existed only because the directory sat inside the per-task folder.
3. `getCheckpointService` passes the new root. The "globalStorageDir not found, disabling checkpoints" branch goes:
   `~/.roo` is always resolvable, so there is no state left to guard against.
4. One-time migration at activation, in the background next to `migrateFromRooCline`: every
   `<globalStorage>/tasks/<taskId>/checkpoints` is renamed to `~/.roo/checkpoints/<taskId>`. `rename` is O(1) on one
   filesystem; a cross-device failure falls back to copy-then-remove, because `customStoragePath` can point at
   another disk. A task that already has a directory in the new root is left alone, so the pass is idempotent.
5. Deleting a task must now delete `~/.roo/checkpoints/<taskId>` as well. Until this change the checkpoints sat inside
   the task folder and `rm -rf` of that folder took them with it; after the move they would survive the task.

## Tests

- `ShadowCheckpointService` specs keep their coverage with the renamed option and the flatter path.
- Migration: a task with checkpoints in globalStorage ends up with them under the new root and nothing left behind; a
  task that already exists in the new root is untouched; a cross-device rename failure still moves the data.
- Task deletion removes the task's checkpoint directory.

## Not in this change

- No retention or pruning of old checkpoints. The owner keeps the existing 12.15 GB; after migration it simply stops
  being in a folder VS Code walks.
- The `workspaceRepoDir`/`deleteTask` pair still addresses the old per-workspace layout that `create` stopped using.
  It is pre-existing and out of scope here; noted so it is not mistaken for part of the move.
