# Dead exports in packages/types (simplification round 2, B8)

Status: done on branch `chore/types-dead-exports`, PR open, not merged.

## Touched files

- `knip.jsonc`: `includeEntryExports: true` for the `packages/types` workspace.
- `packages/core/src/api/__tests__/cost.spec.ts`, `src/api/__tests__/provider-model-id-key.spec.ts`,
  `packages/types/src/__tests__/public-api-no-ipc.spec.ts`: whole-module scans load `@roo-code/types` through a
  variable specifier.
- `packages/types/src/*`: dead exports deleted (list below); `cookie-consent.ts` deleted.
- `packages/types/src/telemetry.ts` -> `packages/telemetry/src/errorReporting.ts`: the API error helpers.
- `packages/types/src/__tests__/telemetry.test.ts` split; the helper tests moved to
  `packages/telemetry/src/__tests__/errorReporting.test.ts`.
- `packages/types/scripts/publish-npm.cjs`, `packages/types/npm/` deleted; `npm:publish` and `build:watch` scripts
  (both wrote to `npm/`) removed from `packages/types/package.json`, `npm:publish:types` from the root
  `package.json`, `npm/package.json` from `packages/types/.gitignore`.

## Problem

knip never reported an unused export of `@roo-code/types`, for two reasons:

1. `src/index.ts` is a package entry (tsup config, `exports` field), and knip skips entry exports by default.
   Everything is re-exported from it with `export *`.
2. Even with `--include-entry-exports`, a probe export added to `packages/types/src/index.ts` was not reported.
   Bisecting the specs that import the package as a namespace showed two culprits:
   `packages/core/src/api/__tests__/cost.spec.ts` (`Object.entries(rooTypes)`) and
   `src/api/__tests__/provider-model-id-key.spec.ts` (`Object.entries(types)`). An opaque use of a namespace
   (enumerating it) makes knip mark every export of the module as used. `public-api-no-ipc.spec.ts`
   (`Object.keys(types)`) has the same shape.

The npm publishing script pointed at the RooCodeInc repository and no workflow or script ran it.

## Fix

- `includeEntryExports: true` on the `packages/types` workspace only. Every consumer of the package is inside this
  repository, so an export nobody imports is dead.
- The three whole-module scans import through a variable (`const typesModule = "@roo-code/types"; await
import(typesModule)`), with a comment saying why. The assertions are unchanged.
- Deleted what knip then reported, in three waves (each deletion orphaned the next):
    - cloud.ts: `ORGANIZATION_DEFAULT`, `INSTANCE_TTL_SECONDS`, `JoinResponse`, `LeaveResponse`, `ConnectionState`,
      `RetryConfig`, `ExtensionTask` (+ its private schema), `ExtensionInstance` + `extensionInstanceSchema`,
      `TaskBridgeEvent` + `taskBridgeEventSchema` (the bridge has its own types in `packages/cloud/src/bridge/types.ts`;
      `TaskBridgeEventName` stays, a cloud spec uses it), `UsageStats` + `usageStatsSchema`.
    - cookie-consent.ts (whole file).
    - global-settings.ts: `rooCodeSettingsSchema`, `isGlobalStateKey`, `EVALS_SETTINGS`, `EVALS_TIMEOUT`.
    - provider-config: `narrowedSettingsToLegacySettings`, `rooConfigSchema`, `humanRelayConfigSchema`,
      `emptyProviderConfigSchema`, `RetiredProviderId`, `ProviderConfig`, `KnownProviderConfiguration`,
      `OpaqueProviderConfiguration`, `RetiredProviderConfiguration`, `UnknownProviderConfiguration`,
      `NarrowedProviderSettings`, `OpaqueNarrowedProviderSettings`, `SharedProfileSettings`.
    - provider-registry.ts: `providerIds`, `ProviderId` (and the private `selectProviderIds` / `ProviderIds` they
      used). The registry entries themselves are untouched.
    - provider-settings.ts: `discriminatedProviderSettingsWithIdSchema`.
    - providers: `lMStudioDefaultModelId`, `ollamaDefaultModelId`, `minimaxDefaultModelInfo`,
      `MINIMAX_DEFAULT_MAX_TOKENS`, `MINIMAX_DEFAULT_TEMPERATURE`, `MOONSHOT_DEFAULT_TEMPERATURE`.
    - types only: `RooCliToolUse`, `RooCliToolResult`, `CodebaseIndexProvider`, `TaskEvent`, `FollowUpDataType`
        - `followUpDataSchema`, `ModeMarketplaceItem`, `CustomModesSettings`, `CustomSupportPrompts`, `AppProperties`,
          `RooCodeTelemetryEvent`, `Coordinate`, `Size`.
- `TelemetryEventName`: `FEATURED_PROVIDER_CLICKED`, `UPSELL_CLICKED`, `UPSELL_DISMISSED` removed. Nothing emits
  them (grep over TS, TSX and Python), and `self-hosted-cloudapi/src/services/telemetry_vocab.py` does not name
  them. The values of every emitted event are unchanged.
- The error helpers (`EXPECTED_API_ERROR_CODES`, `getErrorStatusCode`, `extractMessageFromJsonPayload`,
  `getErrorMessage`, `shouldReportApiErrorToTelemetry`, `isApiProviderError`, `extractApiProviderErrorProperties`,
  `isConsecutiveMistakeError`, `extractConsecutiveMistakeErrorProperties`) moved verbatim to
  `packages/telemetry/src/errorReporting.ts`; their only consumer is `PostHogTelemetryClient.ts`. The classes
  `ApiProviderError` and `ConsecutiveMistakeError` stay in types (src throws them).

## Tests

- `packages/types`: full package suite, 46 files, 718 tests pass.
- `packages/telemetry`: full package suite (incl. the moved `errorReporting.test.ts`), 133 tests pass.
- `packages/core`: `cost.spec.ts` passes; `src`: `provider-model-id-key.spec.ts` passes.
- `tsc --noEmit` in types, telemetry, core, cloud and src: clean. eslint on touched files: clean. `pnpm knip`: exit 0.

## Notes / caveats

- Kept although named in the item description: `getActiveProviderDefinitions` and `getRetiredProviderDefinitions`
  (used by `provider-registry.spec.ts`, which checks the registry lists; knip counts spec use) and
  `generateRoomodesJsonSchema` (used by `scripts/generate-roomodes-schema.ts`).
- A new whole-namespace scan of `@roo-code/types` in any spec (`Object.keys`, `Object.entries`, spreading the
  namespace) silently switches this check off again. Use the variable-specifier import shown in the three specs.
