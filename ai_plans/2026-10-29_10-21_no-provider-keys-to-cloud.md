# Provider keys in cloud uploads

**Status:** fixed on `fix/no-provider-keys-to-cloud`
**Related:** security audit 2026-10-28 follow-up, "provider keys in cloud uploads"
**Touched:** `packages/core/src/redact.ts` (new `./redact` entry), `packages/cloud/src/{CloudService,TelemetryClient,LlmExchangeClient}.ts`,
`packages/cloud/src/bridge/BridgeOrchestrator.ts`, `src/core/config/{CloudSecretValues,ProviderSettingsManager}.ts`,
`src/core/diagnostics/{errorReportFormat,ErrorReporter}.ts`, `src/extension.ts`, `src/extension/{bridge,cloudAuthOnly}.ts`,
`docs/architecture.md`

## Symptom

With the fake key `sk-TEST-LEAK-123` and the real SDKs: a key or `openAiHeaders` value holding a line break makes the
OpenAI and Anthropic SDKs throw `Headers.append: "Bearer sk-TEST-LEAK-123\nX" is an invalid header value.`; a base URL
`https://u:sk-TEST-LEAK-123@host/v1` gives an `APIConnectionError` whose cause names the whole URL.
`handleProviderError` appends that cause to the message (`src/api/providers/utils/error-handler.ts`), and the text
went to the cloud unredacted as an `Exception` event (`errorMessage`, `stack`), as `api_req_failed` /
`api_req_retry_delayed` / streaming-failed task messages (live bridge, task sync, backfill), as `error.message` and
`error.body` of a recorded LLM exchange, and as `CODE_INDEX_ERROR` properties. Error reports were pattern-scrubbed, but
the scrubber missed `user:pass@` in URLs and `sk-` keys under 16 characters (`sk-TEST-LEAK-123` passed).

## What was happening

No setting value is ever serialized into a cloud payload; error text is. Only `finalizeErrorReport` scrubbed, and only
with key-shape patterns, so a key without a known shape (a self-hosted server's key, a custom header value) passed
everywhere, and the other paths were not scrubbed at all: `TelemetryClient.fetch` posted `JSON.stringify(result.data)`,
`backfillMessages` uploaded `JSON.stringify(messages)`, `LlmExchangeClient.post` gzipped the payload as given and
`BridgeOrchestrator` emitted the bus message as given.

## Fix

- `redactSecrets(value, secretValues)` in `@tumble-code/core/redact` (moved from `errorReportFormat.ts`, where
  `scrubSecrets`/`scrubDeep` lived): every string of the payload has each configured value (as stored and trimmed,
  8 characters or more, longest first) replaced by `[redacted]`, then the pattern rules run. New rules: URL
  credentials (`scheme://user:pass@host` becomes `scheme://[redacted]@host`) and `sk-` keys from 8 key characters.
- Every outbound path in `packages/cloud` runs its payload through it just before serializing: `TelemetryClient.post`
  (events, error reports, and so the bodies the retry queue persists), `backfillMessages` (properties and
  `task.json`), `LlmExchangeClient.post` (exchanges and outcomes), `BridgeOrchestrator.emitTaskEvent` (messages and
  instance state).
- The values come from the extension through a hook: `CloudService.createInstance(context, secretValues, ...)`, passed
  to the clients and exposed as `CloudService.secretValues` for the bridge and the error reporter. `src/extension.ts`
  fills it from `CloudSecretValues`: the `SECRET_STATE_KEYS` values and `openAiHeaders` values of the live settings
  (incl. the code-index keys) and of every stored profile (`ProviderSettingsManager.listProfileSettings`), read before
  the cloud starts and again on every `context.secrets.onDidChange` (profiles live in the secret storage too). The CLI
  runs the same `activate()`, so it gets the same wiring; `tumble auth cloud` passes `() => []` because it sends nothing.
- `finalizeErrorReport` takes the secret values and redacts before applying the length limits, so a report still fits
  the schema; the second pass at send then changes nothing.

## Tests

- `packages/core/src/__tests__/redact.spec.ts`: the moved pattern cases plus the header error, short `sk-`, URL
  credentials with and without a user; text left alone; configured values in a nested payload (rest intact), stored
  with whitespace, under 8 characters, overlapping.
- `packages/cloud/src/__tests__/outboundRedaction.spec.ts`, one parametrized test over 7 paths (exception event, synced
  task message, error report, backfill, retry queue's persisted body, LLM exchange upload, bridge task event): with the
  active profile's `sk-TEST-LEAK-123` and another profile's shapeless `free-form-key-7f3a9c`, neither reaches `fetch`,
  the storage or `emit`, and the rest of the text is there.
- Wiring: `CloudService.test.ts` (clients get the hook), `bridge.spec.ts`, `ErrorReporter.spec.ts`,
  `CloudSecretValues.spec.ts` (real `ProviderSettingsManager` over an in-memory secret store: active and other profile,
  header value, code-index key; a failed read keeps the old values), `extension.spec.ts` (the hook given to
  `createInstance` holds every profile's keys and is read again after a secret change).
- Mutations, each turned a test red and was restored: exact-match step off (7/7 paths red), each client's
  `secretValues()` replaced by `[]` (telemetry post, backfill, exchange, bridge), `CloudService` passing `() => []` to
  either client, `extension.ts` passing `() => []`, no initial refresh, no `onDidChange` refresh, `bridge.ts` and
  `ErrorReporter` passing no values, headers dropped from `CloudSecretValues`, URL rule off, `sk-` threshold back to 16,
  no longest-first sort, no trim.

## Not fixed

- A key the model reads or the user pastes into the conversation is redacted only if it is a stored value or has a
  known shape; any other free-form secret in conversation text still reaches the cloud. A key in the path of a base
  URL (`https://host/<key>/v1`) is only redacted when it is also a stored key value.
- MCP server `env` and header values (`mcp.json`) are not in the list: the extension does not store them as secrets.
- `"API Key = ..."` with a space is not a pattern: prose like "Invalid API key: check..." would be mangled.
- Recall queries (`CloudAPI.recallSearch`, a GET query string) and retry-queue bodies persisted by an older version
  are not redacted.
- Server side: `self-hosted-cloudapi/src/services/anonymizer.py` could be applied on the ingest routes as a separate
  backstop; not done in this branch.
