# R3-12 cluster 3 — ClineProvider modes & provider-profiles extraction

Parent item: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 12 (R3-12) — move the
2-3 largest remaining self-contained method clusters out of `ClineProvider.ts`, one cluster per
PR. This is cluster 3 of 3 (cluster 1: pending-edit-operations, #784; cluster 2:
telemetry-properties, #785).

## Cluster census

The read-side mode and provider-profile queries, scattered in two regions of ClineProvider:

- `getModes` (defaults + custom modes, fallback on error), `getMode`, `setMode`,
- `getProviderProfiles` (name/provider map), `getProviderProfile` (active name),
- `getProviderProfileEntries` / `getProviderProfileEntry` (stored metadata),
- `deleteProviderProfile` (next-profile-to-activate choice + last-profile guard + state push).

The write side (mode switches, activation, upsert) was already extracted into
`ModeProfileBinding` (CORE-R6 c); this cluster is its read-side counterpart. Callers reach these
through the provider: `TaskProviderLike` pins the mode/profile members, `extension/api.ts` and
the messageHandlers (providerProfiles, promptsAndModes, taskLifecycle) call them on the provider.

## Change

- New collaborator `src/core/webview/ModeProfileQueries.ts` with a
  `ModeProfileQueriesHost` seam (`getCustomModes`, `getState`, `setValues`, `contextProxy`
  narrowed to get/setValues, `postStateToWebview`).
- `ClineProvider` keeps all members as one-line delegations (public surface unchanged;
  `setProviderProfile` still routes through `activateProviderProfile`, exactly as before).
- Behavior byte-identical: same fallback list on custom-modes error, same
  `SETTINGS_DEFAULTS.currentApiConfigName` default, same delete rewrite (spread of the raw
  values + the two changed keys), same "You cannot delete the last profile" guard, same
  post-delete state push.
- New unit spec `src/core/webview/__tests__/ModeProfileQueries.spec.ts` (11 tests: merge +
  fallback, current mode/profile reads, setMode persistence, entry lookups, all three delete
  paths).

## Files

- `src/core/webview/ModeProfileQueries.ts` (new, 106 lines)
- `src/core/webview/ClineProvider.ts` (two clusters → delegations; `DEFAULT_MODES` import moved)
- `src/core/webview/__tests__/ModeProfileQueries.spec.ts` (new)

## Verification

- `cd src && npx tsc --noEmit` — clean.
- `cd src && npx vitest run`:
    - `core/webview/__tests__/ClineProvider.spec.ts` — 129 passed.
    - `core/webview/__tests__/ModeProfileQueries.spec.ts` — 11 passed.
    - `core/webview/__tests__/webviewMessageHandler.routing.spec.ts` +
      `extension/__tests__/api-delegation-events.spec.ts` — 152 passed (routing spec zero diff).
    - mode/profile spec family (`modeProfileBinding`, `sticky-mode`, `sticky-profile`,
      `cliModeProviderSettings`, `assignConfigToModes`, `modeImportExport`) — 84 passed.
- `pnpm knip` — only the two known pre-existing findings (zoo-prs x2).
- `node scripts/find-test-only-exports.mjs --check` — exit 0.
- Line count: ClineProvider.ts 2217 → 2216 (delegating surface pinned by TaskProviderLike; the
  cluster's 106 lines of logic now live in their own module).

## R3-12 wrap-up (all three clusters)

| Cluster                   | PR     | Squash    | ClineProvider.ts |
| ------------------------- | ------ | --------- | ---------------- |
| 1 pending-edit-operations | #784   | 60970f940 | 2356 → 2312      |
| 2 telemetry-properties    | #785   | 1572aabca | 2307 → 2217      |
| 3 modes/provider-profiles | (this) | —         | 2217 → 2216      |

Skipped: none — all three clusters extracted as planned. The audit's named candidates
(task-history operations, delegation) were already extracted before R3-12 (TaskHistoryGateway,
DelegationService); the clusters above were the largest remaining self-contained groups.
