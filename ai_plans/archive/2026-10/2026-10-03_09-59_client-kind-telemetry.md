# Every cloud record names its client (VS Code or CLI)

Status: done on `feat/client-kind-telemetry`
Overview: [2026-10-03_11-00_cli-cloud-login-overview.md](2026-10-03_11-00_cli-cloud-login-overview.md)
Related plans: `ai_plans/2026-10-02_llm-completion-telemetry-gap.md`, `ai_plans/2026-10-02_error-reports-extension.md`,
`ai_plans/2026-10-02_llm-exchange-dataset.md`
Touched: `packages/types/src/telemetry.ts`, `packages/types/src/error-report.ts`, `packages/types/src/llm-exchange.ts`,
`packages/types/src/cli-runtime.ts`, `apps/cli/src/agent/extension-host.ts`, `src/core/webview/ClineProvider.ts`,
`src/core/diagnostics/ErrorReporter.ts`, `src/core/dataset/ExchangeRecorder.ts`,
`self-hosted-cloudapi/tests/fixtures/llm_exchanges_recorder.json`, `docs/architecture.md`, their specs

## Problem

The CLI runs the same extension bundle as VS Code (on `packages/vscode-shim`), so once it can sign in to the
cloud its events, error reports and LLM exchanges look exactly like the extension's. The only hint is
`editorName`, which the shim sets to `wrapper|cli|cli|<extension version>`: a string the server would have to
parse, absent from error reports' filters, and carrying the extension version rather than the CLI's.

## Fix

- `packages/types/src/telemetry.ts`: `clientKindSchema = z.enum(["vscode", "cli"])` and two
  new static app properties, `clientKind` and `clientVersion`. Both are optional in the schema: the dedicated
  event schemas (`LLM Completion`, `Task Message`) strip unknown keys, so the fields have to be in the shared
  shape to survive, and a required field would make `tumbleCodeTelemetryEventSchema.safeParse` drop every event
  from a producer that does not set it.
- CLI runtime contract: `CLI_RUNTIME_ENV.cliVersion = "ROO_CLI_VERSION"`, read as `cliVersion` by
  `readCliRuntimeEnv`. The `ExtensionHost` constructor sets it from the CLI's `VERSION` next to
  `ROO_CLI_RUNTIME`, so it is in place before `activate()`.
- `ClineProvider.getAppProperties`: `clientKind` is `"cli"` when `ROO_CLI_RUNTIME` is `"1"`, else `"vscode"`;
  `clientVersion` is set only inside the CLI and only when the CLI published a version. The properties are
  cached per provider as before (the environment does not change during a session).
- Error reports and LLM exchanges: optional top-level `clientKind` and `clientVersion` in `errorReportSchema`
  and `llmExchangeSchema`, filled from the provider's app properties next to `appVersion` and `editorName`
  (`ErrorReporter.snapshot`, `ExchangeRecorder.beginExchange`).
- Backfill uploads (`CloudTelemetryClient.backfillMessages`) send `getEventProperties`, which spreads the
  provider's telemetry properties without a schema, so `clientKind` reaches their `properties` with no change.

## Tests

- `packages/types/src/__tests__/cli-runtime.spec.ts`: the new name and its parsing (empty string is unset).
- `packages/types/src/__tests__/telemetry-schema-coverage.spec.ts`: an `LLM Completion` keeps `clientKind` and
  `clientVersion`; an event without them is still accepted.
- `apps/cli/src/agent/__tests__/extension-host.test.ts`: the host publishes `ROO_CLI_VERSION`.
- `src/core/webview/__tests__/ClineProvider.spec.ts` (`getTelemetryProperties` / `client kind`): `vscode`
  without a version outside the CLI, `cli` with the version inside it, no `clientVersion` when none was published.
- `ErrorReporter.spec.ts`, `ExchangeRecorder.spec.ts`: the report and the exchange carry the provider's
  `clientKind` and `clientVersion`.
- `ExchangeRecorder.fixture.spec.ts`: the contract fixture now carries `clientKind: "vscode"`; regenerated with
  `UPDATE_EXCHANGE_FIXTURE=1`. The cloud schemas use `extra="ignore"`, so `test_llm_exchanges.py` and
  `test_dataset_export.py` pass unchanged.

## Notes

- The server side (columns, stamping, the `editorName` fallback for old clients, filters) is
  `feat/cloudapi-client-kind`. Until it lands the cloud ignores the new fields.
- Events from VS Code carry `clientKind` only after a VSIX rebuild; the CLI needs `apps/cli/scripts/build.sh`.
- `clientKind` is not exposed as a setting or derived from `editorName`: the runtime flag is the one fact both
  sides already agree on.
