# R4 G1 + G2: docs/architecture.md drift

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section G).

## Touched files

- `docs/architecture.md`

## Problem

- G1: the dependency section named `packages/cloud/src/backoff.ts` as a re-export of `@tumble-code/core/backoff`.
  That file does not exist; `RefreshTimer.ts`, `bridge/BridgeOrchestrator.ts` and `retry-queue/RetryQueue.ts`
  import `backoffDelayMs` from `@tumble-code/core/backoff` directly. The workspace table listed the core entry
  points without `./backoff`, which `packages/core/package.json` exports.
- G2: the CLI runtime paragraph credited `ClineProvider.getAppProperties` with the `clientKind` mapping. The
  mapping lives in `TelemetryPropertiesSource.getAppProperties` (`src/core/webview/TelemetryPropertiesSource.ts`);
  the provider delegates to it.

## Change

Both passages now describe the code as it is: the three direct importers of `@tumble-code/core/backoff`, the
`./backoff` entry point in the table, and `TelemetryPropertiesSource` as the owner of the `clientKind` mapping.

## Tests

Docs only. `grep -rn 'cloud/src/backoff.ts' docs/` prints nothing.
