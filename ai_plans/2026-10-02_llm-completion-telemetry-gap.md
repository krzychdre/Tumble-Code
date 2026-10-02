# Cloud metrics show a fraction of the real token usage

Date: 2026-10-02
Branch: `fix/llm-completion-telemetry-gap` (from `origin/main` a68659aa1)

Owner, 2026-10-02: llama-swap shows that GLM-5.3-Flash alone used more tokens today than the cloud
metrics page shows for all models, and nearly all of that traffic came from Tumble.

## Evidence

- `telemetry_events`, `LLM Completion` per day: up to 2026-09-28 ~1-2k events a day, almost all with a
  `modelId`; from 2026-09-29 (first VSIX with P9, #564) a few hundred a day, most without a model.
  The drop after 09-28 on the chart is lost telemetry, not lower usage.
- 2026-10-02 18:00-19:59 UTC: 237 rows in `llm_exchanges` (the dataset recorder) and zero telemetry
  events of any type. The api log shows `POST /api/llm-exchanges` and `POST /api/error-reports` in that
  window but no `POST /api/events`: signed in, telemetry on, events never sent.
- VS Code renderer logs (`~/.config/Code/logs/20261002*/window*/renderer.log`): thousands of
  `[TelemetryClient#capture] Invalid telemetry event`, every one missing `appName`, `appVersion`,
  `vscodeVersion`, `platform`, `language`, `mode`; the payload held only the event's own properties.

## Root cause

1. **Startup race (P9).** `extension.ts` calls `TelemetryService.setProvider(sidebar)` synchronously,
   but the cloud client is registered only after `CloudService` starts in the background.
   `setProvider` ignored a provider set while there was no client, and `register` never handed one
   over. The cloud client had no provider, so `getEventProperties` returned only the event's own
   properties, `tumbleCodeTelemetryEventSchema` rejected every event and `capture` dropped it.
2. **Editor tab hijack.** Every `ClineProvider` constructor called `setProvider(this)`, so opening an
   editor tab replaced the provider; clients hold it in a `WeakRef`, and once the closed tab was
   collected the events lost their properties again. This is why telemetry came and went during a
   day (it worked while some tab provider was alive).
3. **Borrowed labels.** The task `LLM Completion` took `modelId` and `mode` from the registered
   provider's current task. A turn in an editor tab or a delegated subtask was reported without a
   model ("unknown" on the metrics page) or under another task's model and mode.

## Fix

- `TelemetryService` remembers the provider and passes it to clients registered later.
- `ClineProvider` no longer registers itself; activation registers the sidebar, which lives as long
  as the extension.
- `TaskStreamProcessor`'s usage drain states `modelId` (`api.getModel().id`), `apiProvider` (retired
  providers left out, the schema enum would reject them) and `mode` (`_taskMode`) on the event.
  `mode` added to the `LLM_COMPLETION` payload type.

## Tests

- `packages/telemetry/src/__tests__/TelemetryService.provider.spec.ts`: provider set before the client
  registers reaches it.
- `src/core/task/__tests__/TaskStreamProcessor.usage-drain.spec.ts`: the event carries the task's
  model, provider and mode.

## Not covered (known, by design)

- Rows already lost (2026-09-29 .. today) are not recoverable from telemetry. `llm_exchanges` exists
  only from 2026-10-02 18:00 UTC.
- llama-swap will still read somewhat higher: embeddings (own `Embedding Usage` event), cancelled
  requests without a usage block and requests from other clients are not `LLM Completion` events.
- Takes effect after a VSIX rebuild and reload of every VS Code window.
