# SVC-9 leftover: tests for deletePointsByMultipleFilePaths (2026-09-25)

Branch: `test/svc-9-delete-points-by-file-paths`

## Goal

`QdrantVectorStore.deletePointsByMultipleFilePaths` in
`src/services/code-index/vector-store/qdrant-client.ts` had no unit test of its own (only one
happy-path wire test in `qdrant-client.wire.spec.ts`). Add characterization tests against the real
method with a mocked Qdrant client.

## Spec

`src/services/code-index/vector-store/__tests__/qdrant-client.delete-by-paths.spec.ts` loads the real
module twice (`vi.resetModules` + `vi.doMock("path")`), once with `path.posix` and once with
`path.win32`, so Windows separators are covered on Linux CI too. All paths are built with the path
implementation under test.

Pinned behavior:

- empty input: no collection probe, no delete;
- collection missing (or `getCollection` failing for any reason): the delete is skipped silently;
- one path: `{ must: [pathSegments.0 = ..., pathSegments.1 = ...] }`, no `should` wrapper;
- absolute paths inside the workspace become workspace-relative segments; `.` and `..` are normalized;
- an absolute path outside the workspace yields `..` segments (matches nothing indexed);
- a directory path is a prefix match (every point below it matches);
- several paths go in ONE delete call as `{ should: [ {must}, ... ] }`, no batching (251 paths tested);
- the filter equals the `pathSegments` that `upsertPoints` stores for the same file.

## Bug found: a failed delete was swallowed

Upstream commit 5041880da (#6296) made the method log and rethrow, and made the callers handle the
error. Upstream commit 11c454ffa (#7182, "on-disk storage", otherwise unrelated) dropped the
`throw error`, so the method has resolved on every Qdrant delete failure since. Consequences, all in
code whose error branch was therefore dead:

- `FileWatcher._handleBatchDeletions`: the hash of a deleted file was removed and the file reported as
  success, so the stale points were never retried (the scanner's deleted-file sweep walks the cache).
- `FileWatcher._clearPointsOfReindexedFiles`: returned "no error", the new points were upserted next
  to the old ones and the new hash stored.
- `DirectoryScanner.processBatch`: same for modified files during a scan (its retry never ran).

Fix: rethrow through `withQdrantDetail`, like the sibling methods, so the message carries Qdrant's
reason and keeps `status` and `cause`. Covered by the last test of the spec (fails before, passes
after).

## Not changed (noted)

- `collectionExists` maps every `getCollection` failure (including "Qdrant unreachable") to "does not
  exist", so an unreachable server still skips the delete silently. Out of scope here.
