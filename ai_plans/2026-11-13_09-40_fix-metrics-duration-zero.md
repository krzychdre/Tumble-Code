# Metrics page Duration always 0s - investigation & fix

**Status:** fixed on `fix/metrics-duration-zero`
**Related plans:** #1165 (request timing), #1175 (run wall duration)
**Touched:**

- `packages/types/src/telemetry.ts`
- `packages/types/src/__tests__/telemetry-schema-coverage.spec.ts`
- `.changeset/metrics-duration-zero.md`

## Symptom

The cloud `/app/metrics` page showed `DURATION 0s` for 24 tasks and 561 API completions.

Live database: every `LLM Completion` row in `telemetry_events` has `duration_ms = 0`
(2026-10-30 to 2026-11-13, 48861 events in 60 days), and no stored `properties` payload
contains the key `durationMs`.

## What was happening

- `TaskStreamProcessor` (and `summarize.ts` for condensing) captures `durationMs` on
  `LLM Completion` since #1165, and the payload type in `TelemetryEventPayloads` declares it.
- `TelemetryClient` (`packages/cloud/src/TelemetryClient.ts`) posts
  `tumbleCodeTelemetryEventSchema.safeParse(payload).data`. The dedicated `LLM_COMPLETION`
  branch of that schema is a plain `z.object`, which strips keys it does not list, and it
  did not list `durationMs`.
- The server reads `props.durationMs` into `telemetry_events.duration_ms`
  (`telemetry_vocab.event_columns`), the usage rollup sums it, and the metrics card shows the
  sum: always 0.

Task list and task detail durations were not affected: they come from the
`api_req_started` task messages, not from `LLM Completion`.

## Failure surface (before/after)

| Scenario                     | Before                         | After                           |
| ---------------------------- | ------------------------------ | ------------------------------- |
| Task turn completes          | `durationMs` stripped, card 0s | stored and summed               |
| Condense request completes   | stripped                       | stored                          |
| Enhance / memory request     | never measured                 | unchanged (no `durationMs`)     |
| Events stored before the fix | 0                              | still 0 (figure was never sent) |

## Fix

`durationMs: z.number().optional()` in the `LLM_COMPLETION` properties schema. No server change.

## Tests

`telemetry-schema-coverage.spec.ts`: "keeps every property an LLM Completion producer may send"
parses an event holding every key of `Required<TelemetryEventPayloads[LLM_COMPLETION]>` and
expects all of them back. The `Required<...>` type makes `check-types` fail when a new payload
key is not listed in the test, so the next missing schema key is caught too.
Mutation check: without the schema line the test fails on `"durationMs": 7`.

## Notes

The fix takes effect only after the VSIX and the CLI are rebuilt and installed; the api image
needs no rebuild.
