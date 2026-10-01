# Port Zoo PR #691 — serialize delegateParentAndOpenChild with atomicReadAndUpdate

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #691, commit `667096238`, merged 2026-06-25.
- Authors: edelauna (Elliott de Launay), Naved Merchant.
- Commit trailers:
    ```
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    Co-authored-by: Naved  Merchant <naved.merchant@gmail.com>
    ```

## §1 What & why (concurrency fix)

`delegateParentAndOpenChild` persisted parent delegation metadata with a separate
read (`getTaskWithId`) then write (`updateTaskHistory`) — a concurrent writer could
interleave and clobber the read-modify-write. This adds
`TaskHistoryStore.atomicReadAndUpdate(taskId, updater)`, which reads from cache and
writes back within a single lock acquisition, and switches delegation to use it.
Builds on our existing delegation work.

Our `TaskHistoryStore.ts` matched Zoo's pre-PR exactly, and our ClineProvider's
step-5 block matched, so the core port applied cleanly.

## §2 Edits

- `src/core/task-persistence/TaskHistoryStore.ts`:
    - extract `_upsertUnlocked()` from `upsert()` (so it can run inside a held lock).
    - add `atomicReadAndUpdate()` — deep-copies the cached item, runs the pure updater,
      guards the id, and persists via `_upsertUnlocked` inside `withLock`.
- `src/core/webview/ClineProvider.ts`: step 5 of `delegateParentAndOpenChild` now
  calls `taskHistoryStore.atomicReadAndUpdate(...)`; after the lock releases it
  invalidates `recentTasksCache` and (when `isViewLaunched`) posts
  `taskHistoryItemUpdated` to the webview.

## §3 Tests

- Added `src/__tests__/delegation-concurrent.spec.ts` (new upstream file, 4 cases
  exercising the atomic serialization / no-interleave invariant).
- Adopted the upstream `provider-delegation.spec.ts` rewrite (makeStoreStub +
  `atomicReadAndUpdate` assertions, incl. the new `isViewLaunched` postMessage cases)
  **minus its rollback test** — our `delegateParentAndOpenChild` logs on persist
  failure and continues (no rollback), so that upstream test does not apply here.
  (Our fork had already dropped the corresponding pre-PR rollback test.)

## §4 Verify (binary acceptance) — all ✓

- `pnpm --filter tumble-code check-types` passes.
- `npx vitest run __tests__/provider-delegation __tests__/delegation-concurrent` → 8 pass.
- `npx vitest run core/task-persistence/__tests__/TaskHistoryStore` → 28 pass.
