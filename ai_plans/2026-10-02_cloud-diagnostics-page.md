# Cloud diagnostics page: errors and feature usage

Date: 2026-10-02
Branch: `feat/cloud-diagnostics-page` (stacked on `fix/remove-upstream-roo-links`)

## Why

Follow-up to `2026-10-02_remove-posthog-and-telemetry-consent.md`: with PostHog gone, errors
and feature usage should be visible in the user's own cloud, next to `/app/metrics`.

## What the data looked like (live DB, 2026-10-02)

- 10,293 `Tool Used` and 1,743 `Code Index Error` rows, none with the tool name or the error.
- Cause, proven with a direct `safeParse`: the generic branch of
  `tumbleCodeTelemetryEventSchema` used a plain `z.object`, which strips unknown keys. Every
  property an event sets itself (`tool`, `newMode`, `location`, `error`, `schemaName`, ...) was
  dropped in the extension before sending. The test that pinned it came from the PKG-11
  refactor as a characterization, not as a privacy decision.
- `CloudTelemetryClient.captureException` was a no-op, so provider errors, mistake-limit and
  tool-result-id errors never left the extension.

## Change

Extension:

- Generic event properties use `.passthrough()`, so the event's own fields are sent.
- New `TelemetryEventName.EXCEPTION = "Exception"`. `CloudTelemetryClient.captureException`
  sends it with `errorName`, `errorMessage` (2,000 chars max), `stack` (4,000 chars max), the
  error's own primitive fields (`provider`, `modelId`, `taskId`, ...) and the extra properties.

Cloud API:

- `services/diagnostics_service.py`: reads every event type except LLM Completion, Embedding
  Usage, Task Message and Conversation Message. Errors (`telemetry_vocab.ERROR_EVENT_LABELS`)
  are grouped by type + signature (errorName, location/schemaName/operation/provider, first
  line of the message; digits blanked for the key). Errors that never carry a message fall back
  to the task's `modelId`. Usage: tool counts by name, other events by their dimension
  (`USAGE_DIMENSIONS`), long breakdowns fold into "N more".
- `routers/web_diagnostics.py`, `templates/diagnostics.html`, nav tab "Diagnostics", CSS.
- All live history aggregates in ~74 ms (14,434 rows); rows from older extensions show as
  "(not recorded)" with a note.

Not changed: retention. Diagnostic events are ordinary telemetry and are swept by the
telemetry retention policy; only LLM Completion and Embedding Usage are protected.

Docs: `PRIVACY.md` (errors may name local files and folders), cloudapi README, `docs/08-cloud.md`.

## Still owed

VSIX rebuild (the extension side) and an api image rebuild (the page). Until the VSIX is
rebuilt, the page shows only counts and model splits.
