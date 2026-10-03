# R3-12 cluster 2 — ClineProvider telemetry-properties extraction

Parent item: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 12 (R3-12) — move the
2-3 largest remaining self-contained method clusters out of `ClineProvider.ts`, one cluster per
PR. This is cluster 2 of 3 (cluster 1: pending-edit-operations, PR #784).

## Cluster census

The telemetry-properties cluster, ~130 lines inline in ClineProvider:

- `_appProperties` / `_gitProperties` cached fields,
- `getAppProperties` (CLI-runtime detection + packageJSON fallbacks),
- `getCloudProperties` (CloudService auth state, error-tolerant),
- `getTaskProperties` (language/mode/model/diffStrategy/todos of the event's task),
- `getOtherTaskLineage` (subagent registry → history-store fallback for a non-current task),
- `getGitProperties` + `getTelemetryProperties` composition.

Consumers read these THROUGH the provider: `TaskProviderLike` and
`TelemetryPropertiesProvider` (packages/types) pin `appProperties`, `gitProperties`,
`getTelemetryProperties` on the provider surface; `ErrorReporter.ts:302` and
`ExchangeRecorder.ts:234` read `appProperties` off `providerRef.deref()`; the telemetry clients
call `getTelemetryProperties(taskId)`.

## Change

- New collaborator `src/core/webview/TelemetryPropertiesSource.ts` with a
  `TelemetryPropertiesSourceHost` seam (`getState`, `getCurrentTask`, `subagentParentOf`,
  `getTaskHistoryStore`, `extensionPackageJSON` getter). The seam declares exactly what the
  cluster touches; `subagentParentOf` is its own one-member group (R3-8 convention: one group
  per member; only this module touches it).
- `ClineProvider` keeps the three pinned members as one-line delegations (public surface
  unchanged). `getTaskProperties`/`getOtherTaskLineage`/`getCloudProperties` were private and
  move wholly into the collaborator.
- Behavior byte-identical: same caching, same fallbacks (`extensionPackageJSON` is still
  `this.context.extension?.packageJSON`, NOT a vscode.extensions lookup), same retired-provider
  filter, same error-tolerant cloud check, same lineage precedence (subagent registry first,
  history store fallback, "no parent" on store error).
- New unit spec `src/core/webview/__tests__/TelemetryPropertiesSource.spec.ts` (6 tests: caching,
  git-undefined-before-first-event, current-task composition, both lineage sources, store-error
  fallback).

## Files

- `src/core/webview/TelemetryPropertiesSource.ts` (new, 174 lines)
- `src/core/webview/ClineProvider.ts` (cluster → 3 delegations; imports cleaned)
- `src/core/webview/__tests__/TelemetryPropertiesSource.spec.ts` (new)

## Verification

- `cd src && npx tsc --noEmit` — clean.
- `cd src && npx vitest run`:
    - `core/webview/__tests__/ClineProvider.spec.ts` — 129 passed (incl. the whole
      `getTelemetryProperties` describe block, unmodified).
    - `core/webview/__tests__/TelemetryPropertiesSource.spec.ts` — 6 passed.
    - `core/webview/__tests__/webviewMessageHandler.routing.spec.ts` — 120 passed, zero diff
      (audit ground rule).
    - `core/diagnostics/__tests__/ErrorReporter.spec.ts` +
      `core/dataset/__tests__/ExchangeRecorder.spec.ts` — 32 passed (appProperties consumers).
- `pnpm knip` — only the two known pre-existing findings.
- `node scripts/find-test-only-exports.mjs --check` — exit 0.
- Line count: ClineProvider.ts 2307 → 2217 (-90).
