# One atomic write (simplification round 2, C9)

Status: done on branch `refactor/one-atomic-write`, PR open, not merged.

## Touched files

- `packages/core/src/fs/writeFileAtomic.ts` (new): `writeFileAtomic(path, data, { mode?, rename? })` and the
  procedure behind it, `replaceFileAtomically(path, writeTemporary, options)`.
- `packages/core/src/fs/index.ts`: exports `writeFileAtomic` and its options type.
- `packages/core/src/fs/safeWriteJson.ts`: the locked JSON writer streams into `replaceFileAtomically`; its own
  mode lookup and `flushToDisk` are gone. Locking is unchanged.
- `src/core/artifacts/ArtifactStore.ts`: `save` calls `writeFileAtomic`; the local `flushToDisk` is gone.
- `packages/agent-interchange/src/handoffs.ts`: `atomicWrite` is `mkdir` + `writeFileAtomic(file, content, { mode:
0o600, rename: io.rename })`; the directory fsync (`syncDirectory`, `HandoffIo.syncDirectory`) is gone.
- `packages/agent-interchange/src/install/index.ts`: `writeAtomically` also uses `writeFileAtomic` (a fourth copy
  found while reading).
- Specs: `packages/core/src/fs/__tests__/writeFileAtomic.spec.ts` (new); `ArtifactStore.spec.ts` injects write
  failures through `fs/promises`; `handoffs.spec.ts` bundles its worker with the same `require` banner as
  `esbuild.mjs` and drops the directory-fsync test.
- `docs/architecture.md`: `./fs` entry lists `writeFileAtomic`.

## Problem

Four temp-file-and-rename implementations with different durability:

- `safeWriteJson` (packages/core): keeps the existing mode, fsyncs the file, renames.
- `ArtifactStore.save` (src) with its own `flushToDisk`: fsyncs the file, renames.
- `handoffs.ts` `atomicWrite` (~703-737): mode 0600, fsyncs the file, renames, then fsyncs the directory. The R2
  decision (`ai_plans/2026-09-27_r2-safe-write-json-fsync.md`) ruled the directory sync out: Windows cannot open a
  directory handle, and the file sync already closes the empty-file window.
- `install/index.ts` `writeAtomically`: given mode, fsyncs the file, renames.

## Fix

One procedure: temporary file `.<name>.new_<pid>_<uuid>.tmp` in the same directory, created exclusively; `chmod`
to the requested mode, or else to the mode of the file being replaced (a new file keeps the default); fsync;
rename over the target (`options.rename` replaces `fs.rename`, which keeps the handoff tests' hook for stalling a
writer at the publish step); on any failure the temporary file is removed. It does not create the parent directory;
callers that need it keep their `mkdir` (safeWriteJson, the handoffs, the installer, ArtifactStore).

## Tests

- New `writeFileAtomic.spec.ts` (10 tests): new file, replace with string and Buffer, no parent creation, default
  mode, kept mode, explicit mode for new and replaced files, failure midway (old content kept, no partial or
  temporary file), failure on a new file (nothing under the name), failure at rename (old content kept, temporary
  removed), fsync of the temporary file before its rename.
- packages/core `src/fs` 32 pass; packages/agent-interchange full suite 117 pass (incl. the two child-process
  concurrency tests); 38 src spec files that touch safeWriteJson, proper-lockfile, ArtifactStore or the interchange
  package: 945 pass.
- The MCP server bundled to /tmp with the `esbuild.mjs` options loads and exits cleanly on closed stdin.
- `tsc --noEmit` core, agent-interchange, src clean; eslint; prettier; `pnpm knip` exit 0.

## Notes / caveats

- The handoff files no longer get a directory fsync, as the item asked. On Linux a power loss right after a rename
  can, on some file systems, lose the rename itself (the old file stays); the content is never torn.
- `@roo-code/core/fs` now reaches the MCP server bundle through `handoffs.ts`, which brings `proper-lockfile` and
  `json-stream-stringify` into it (the installer bundle already had them). The bundle's `require` banner covers
  their CommonJS code.
- ArtifactStore's two failure tests used to spy on `fs.promises.writeFile` from `fs`; a spy on that object does not
  reach the `fs/promises` module namespace the shared code imports, so the spec now wraps `fs/promises` the same way
  the safeWriteJson spec does. The assertions are unchanged.
