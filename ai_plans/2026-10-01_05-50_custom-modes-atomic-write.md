# Custom modes files are written atomically

Status: done (branch `fix/custom-modes-atomic-write`)

## Touched files

- `src/core/config/CustomModesManager.ts`
- `src/core/config/__tests__/memoryFiles.ts` (new test helper)
- `src/core/config/__tests__/CustomModesManager.spec.ts`
- `src/core/config/__tests__/CustomModesManager.exportImportSlugChange.spec.ts`

## Problem

`CustomModesManager.updateModesInFile` (`src/core/config/CustomModesManager.ts:531` before the change) wrote the
whole modes YAML with `fs.writeFile` straight over the target. `fs.writeFile` truncates the file first and then
writes, so a crash, a full disk or a killed extension host in the middle leaves a truncated `.roomodes` or
`custom_modes.yaml`; the next load cannot parse it and every custom mode in that file is gone from the UI until the
user repairs it by hand. The two writes that create or reset the global file with an empty list (`:242`
`getCustomModesFilePath`, `:635` `resetCustomModes`) had the same shape.

## Fix

All three writes go through `writeFileAtomic` from `@roo-code/core/fs` (temporary file in the same directory, sync,
rename over the target). Its precondition, an existing parent directory, holds on every path:

- global file: `getCustomModesFilePath` calls `ensureSettingsDirectoryExists` before it returns the path, and both
  the update and the reset path get the file path from it;
- `.roomodes`: the parent is the workspace root (`updateCustomMode` refuses a project mode without a workspace
  folder; `deleteCustomMode` only writes a `.roomodes` that `getWorkspaceRoomodes` found on disk).

The writes stay inside the existing write queue. The file watchers watch the exact target paths, so the temporary
file (`.<name>.new_<pid>_<uuid>.tmp`) does not trigger them; the rename shows up as a change of the target.

## Tests

The specs mocked `fs/promises` and asserted on the arguments of `writeFile` (target path, content, `"utf-8"`), which
no longer describes the behaviour: the content now goes to a temporary file and is renamed. They now use
`memoryFiles.ts`, an in-memory file map behind the mocked `writeFile`, `readFile`, `rename`, `open`, `chmod`,
`unlink` and file `stat`, and assert what ends up under the target path (the modes YAML, the imported rule files,
no stray temporary file). Several assertions became stricter: the cache tests now also check that the re-read modes
contain the update or the deletion, the rule-file tests check exact paths and contents, and the project-mode test
checks that the global file was left as it was. Three `stat` rejections that stood for "directory missing" now carry
`code: "ENOENT"`, which is what a missing path really reports (the atomic write asks `stat` for the mode of the file
it replaces and rethrows any other error).

Regression test: `CustomModesManager.spec.ts` "keeps the old file when writing the new content fails midway" lets
the first write store 10 characters and then fail with ENOSPC; the old file must be unchanged and no temporary file
may remain. It fails on the old code (the file is left as `customMode`).

Runs: `src/core/config/__tests__/` (264 passed), `autoImportSettings`, `SimpleInstaller`, `SimpleInstaller.mcpWrites`,
`marketplace-files` specs; `tsc --noEmit` in `src`; eslint; knip.

## Notes

- A `.roomodes` that is a symbolic link is now replaced by a regular file on the first write (rename replaces the
  link, `fs.writeFile` followed it). The other atomic writers in the repo (safeWriteJson users) behave the same way.
- `orphanedRules` and `yamlEdgeCases` specs do not write and were left as they were.
- Rule files under `.roo/rules-<slug>/` written by `modeExport.ts` still use plain `fs.writeFile`; they are separate
  small files and out of scope here.
