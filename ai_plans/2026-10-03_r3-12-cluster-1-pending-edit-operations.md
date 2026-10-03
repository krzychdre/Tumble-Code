# R3-12 cluster 1 — ClineProvider pending-edit-operations extraction

Parent item: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 12 (R3-12) — move the
2-3 largest remaining self-contained method clusters out of `ClineProvider.ts` along the
established `*Host` collaborator pattern, one cluster per PR. This is cluster 1 of 3.

## Cluster census (what moved and why this is a cluster)

`ClineProvider.ts` at main was 2356 lines. The audit's named clusters (task-history operations,
delegation) were already extracted (`TaskHistoryGateway.ts` 751, `DelegationService.ts` 690) —
R3-12 continues on the remaining self-contained method groups. The pending-edit cluster was the
clearest one:

- the `PendingEditOperation` interface (9 lines),
- the `pendingOperations` map + `PENDING_OPERATION_TIMEOUT_MS` static,
- `setPendingEditOperation` / `getPendingEditOperation` / `clearPendingEditOperation` /
  `clearAllPendingEditOperations` (~65 lines, incl. the timeout-cleanup timer logic),
- consumed in `createTaskWithHistoryItem`'s pending-edit replay block and in `dispose()`.

## Change

- New collaborator `src/core/webview/PendingEditOperations.ts` (class, no host seam needed: it
  touches nothing on the provider — pure in-memory bookkeeping + timers).
- `ClineProvider` keeps the four members as one-line delegations because external call sites
  (`checkpointRestoreHandler.ts:48`, `dispose()`, `createTaskWithHistoryItem`) and two specs
  (`single-open-invariant.spec.ts`, `task-resume-ui.spec.ts`) mock
  `getPendingEditOperation`/`clearPendingEditOperation` directly on the provider. Public surface
  unchanged; behavior byte-identical (same 30 s timeout, same log tags, same replace-on-set).
- New unit spec `src/core/webview/__tests__/PendingEditOperations.spec.ts` (6 tests, incl. the
  self-timeout via fake timers).

## Files

- `src/core/webview/PendingEditOperations.ts` (new)
- `src/core/webview/ClineProvider.ts` (field + 4 methods → delegation; interface moved)
- `src/core/webview/__tests__/PendingEditOperations.spec.ts` (new)

## Verification

- `cd src && npx tsc --noEmit` — clean.
- `cd src && npx vitest run`:
    - `core/webview/__tests__/ClineProvider.spec.ts` — 129 passed.
    - `__tests__/single-open-invariant.spec.ts`, `__tests__/task-resume-ui.spec.ts`,
      `core/webview/__tests__/webviewMessageHandler.routing.spec.ts`,
      `core/webview/__tests__/checkpointRestoreHandler.spec.ts`,
      `core/webview/__tests__/webviewMessageHandler.checkpoint.spec.ts` — 170 passed.
    - `core/webview/__tests__/PendingEditOperations.spec.ts` — 6 passed.
- `webviewMessageHandler.routing.spec.ts` — zero diff (audit ground rule).
- `pnpm knip` — only the two known pre-existing findings (zoo-prs.mjs x2, .css hint).
- `node scripts/find-test-only-exports.mjs --check` — exit 0.
- Line count: ClineProvider.ts 2356 → 2312 (-44).
