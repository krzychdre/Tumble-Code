# R2: fsync the temporary file before the atomic rename

Item R2 of `2026-09-27_simplification-roadmap.md`.

## Problem

`safeWriteJson` (`packages/core/src/fs/safeWriteJson.ts`) streams JSON to a temporary file and renames it over the
target. The rename is atomic, but without an `fsync` the file system may persist the rename before the file's
data. After a power loss the target name can then point at an empty file, which the readers treat as corrupt
(see R1).

## Change

`streamJsonToTemporaryFile` ends with `flushToDisk`: open the temporary file, `handle.sync()`, close. The rename
follows. The directory entry is not synced, because Windows cannot open a directory handle; the file sync closes
the empty-file window, which is the failure users see.

## Tests

`safeWriteJson.spec.ts` records the order of `sync` and `rename` calls and asserts the temporary file is synced
immediately before it is renamed. The case fails without the fix. All 488 `packages/core` tests pass, and the
`src` suite shows no new failures (only the known ones that need built `dist` and tree-sitter wasm assets).
