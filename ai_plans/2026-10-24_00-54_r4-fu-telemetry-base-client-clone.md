# R4 follow-up: the telemetry package's unused BaseTelemetryClient

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution": clones outside the plan).

## Touched files

- `packages/telemetry/src/BaseTelemetryClient.ts` (deleted)
- `packages/telemetry/src/index.ts`

## Problem

`BaseTelemetryClient` existed twice, line for line: exported from `packages/telemetry/src/BaseTelemetryClient.ts`
and as a private class in `packages/cloud/src/TelemetryClient.ts`, the base of `CloudTelemetryClient`.

## Change

`docs/architecture.md` lets `packages/cloud` import only `core` and `types`, not `telemetry`, so cloud cannot reuse
the telemetry copy. The telemetry copy, however, has no subclass and no importer anywhere in the workspace: its
last subclass, the PostHog client, went with #746. The dead copy is deleted with its export; the cloud copy, the one
`CloudTelemetryClient` extends, stays where it is used. Moving it to `types` (the only package both may import)
would put a runtime class into the schema package for a single user, so it stays in cloud.

## Tests

`packages/telemetry` (42 specs) and `packages/cloud` type-check and pass; `pnpm knip` is clean. No behaviour change,
nothing to mutate: the deleted class had no caller.
