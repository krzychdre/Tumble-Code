# CLI Provider Parity: connect to the same inference providers as the extension

**Date:** 2026-08-04
**Status:** Implemented on `feat/10-cli-provider-parity` (branch stacked on `rebrand/09-cli-tumble`)
**Master plan:** [[2026-05-26_rebrand-roo-to-tumble-code]] — this is branch 10 in the CLI stack

## Motivation

The CLI already loads and activates the real extension bundle in-process
(`apps/cli/src/agent/extension-host.ts`), so every provider the extension supports is
architecturally reachable. The only constraint was the CLI's own user-facing gates: a
hard-coded allowlist of 5 providers (`apps/cli/src/types/types.ts`), a 5-entry env-var map
(`apps/cli/src/lib/utils/provider.ts`), and an unconditional API-key `exit(1)` that also
blocked keyless providers (ollama, lmstudio).

Goal: derive the CLI provider list from the shared `@roo-code/types` registry, map every
supported provider to env vars, gate the API key per provider schema, add a generic
`--base-url` flag, and persist provider/model/base-url between runs.

## Decisions

1. **Provider list is derived, not hand-maintained.** `supportedProviders` =
   `activeProviderIds` (from `packages/types/src/provider-registry.ts`) minus 4 excluded
   ids, each with a documented reason:

    - `vscode-lm` — requires the real VS Code LM API (`vscode.lm.selectChatModels`); the
      CLI's `@roo-code/vscode-shim` mock object (`create-vscode-api-mock.ts`) provides no
      `lm` property, so it would throw at runtime.
    - `openai-codex` — OAuth via `OpenAiCodexOAuthManager`, initialized with the VS Code
      extension context and driven by a browser callback on `localhost:1455`
      (`src/integrations/openai-codex/oauth.ts`); no shimmable or CLI-style auth path.
    - `fake-ai` — hidden internal test provider, not an inference provider.
    - `gemini-cli` — hidden lifecycle; has no runtime factory (listed in
      `providerIdsWithoutRuntimeHandler` in `src/api/runtime-provider-registry.ts`) and no
      API-key field; the extension falls back to the Anthropic handler, which is misleading
      for CLI users.
      Result: **23 supported providers** (30 runnable in the extension, minus the 4 above).

2. **Validation reuses the extension's classification.** `--provider` and persisted
   provider values are validated with `classifyProvider`/`isProviderName` from
   `@roo-code/types`. Retired providers get the same message shape as the extension's
   `ProviderUnavailableError` ("Sorry, provider X is no longer supported. Please select a
   different provider in your API profile settings."); unknown ids get the extension's
   "unknown to this version" message shape.

3. **Env-var map per provider, read from the zod schemas** in
   `packages/types/src/provider-settings.ts`. Each provider's key field
   (`openRouterApiKey`, `deepSeekApiKey`, ...) maps to a conventional `<UPPER_SNAKE>_API_KEY`
   var; base-url fields (`openRouterBaseUrl`, `ollamaBaseUrl`, ...) map to
   `<PROVIDER>_BASE_URL` vars. Two native-SDK conveniences are honored:

    - `gemini` also accepts `GEMINI_API_KEY` and `GOOGLE_GEMINI_BASE_URL` (the bundled
      Google SDK reads them from the environment natively);
    - `bedrock`/`vertex` credentials come from the AWS/GCP SDK default chains
      (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `~/.aws`, `GOOGLE_APPLICATION_CREDENTIALS`)
      — no CLI key needed.

4. **Key gate is schema-derived.** A provider "requires a key" iff it has a key field in
   its settings schema, except `ollama` (key optional; localhost-first, runs keyless). The
   keyless set is `{ollama, lmstudio, bedrock, vertex, qwen-code}` — ollama by explicit
   exception, the rest because their schemas have no single API-key field. Keyed providers
   keep the existing hard `exit(1)` message when no key is available.

5. **`--base-url` flag** applies to the selected provider's base-url field; providers
   without a base-url field (unbound, vercel-ai-gateway, xai, ...) reject it with a clear
   error instead of silently ignoring it.

6. **Persistence**: `--provider`, `--model`, `--base-url` are saved to
   `cli-settings.json` (`CliSettings`) when they differ from stored values; next run reads
   them back. Precedence stays flags > settings > defaults. Keys are never persisted.

7. **No UI/general settings changes beyond `apps/cli` + `ai_plans/`** — `packages/types`
   already exports everything needed (`activeProviderIds`, `classifyProvider`,
   `isProviderName`, `providerNamesSchema`, schemas).

## Implementation summary

| File                                                                 | Change                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/src/types/types.ts`                                        | Replace 5-entry allowlist with derived `supportedProviders` from `activeProviderIds` minus documented exclusions; `CliSettings` gains `baseUrl`                                                                                                |
| `apps/cli/src/lib/utils/provider.ts`                                 | Full provider table: envVarMap (key vars + base-url vars), key-field + base-url-field + model-field maps read from the schemas, `getProviderSettings(provider, apiKey, model, baseUrl)`, `requiresApiKey`, `validateProvider`, `resolveApiKey` |
| `apps/cli/src/commands/cli/run.ts`                                   | Derived validation (unknown / retired / excluded-cli messages), schema-based key gate, `--base-url` wiring, persistence of provider/model/base-url via `saveSettings`                                                                          |
| `apps/cli/src/agent/extension-host.ts`                               | `baseUrl` plumbed through `ExtensionHostOptions` into `getProviderSettings`                                                                                                                                                                    |
| `apps/cli/src/index.ts`                                              | New `--base-url <url>` flag                                                                                                                                                                                                                    |
| `apps/cli/README.md`                                                 | Full provider/env-var table, `--base-url`, keyless-provider behavior                                                                                                                                                                           |
| `apps/cli/src/lib/utils/__tests__/provider.test.ts` + settings tests | Derived-list, env-map coverage, key-gate, settings-precedence tests                                                                                                                                                                            |

## Validation

- `cd apps/cli && npx vitest run` — all tests pass.
- `cd apps/cli && pnpm build` (tsup + dts) — build passes.
- Smoke: `node dist/index.js --help` lists `--base-url`; `--provider ollama` runs
  keyless; `--provider groq` prints the retired-provider error.

## Notes / remaining

- `qwen-code` is accepted keyless (schema has no key field) but requires cached OAuth
  credentials on disk — documented in the README.
- `openai` (compatible) and `openai-native` share `OPENAI_API_KEY`/`OPENAI_BASE_URL`;
  only one is active per run, so the shared names are unambiguous.
- `bedrock` marks itself keyless because the AWS SDK resolves credentials from the
  standard env/profile chain; passing `--api-key` maps to the token-based
  `awsApiKey` + `awsUseApiKey` fields.

## Review fixes (applied on feat/10-cli-provider-parity)

- **Major 1** — verified: the extension handler `src/api/providers/openai-native.ts`
  reads `openAiNativeBaseUrl` (not `openAiNativeUrl`); the CLI map already used
  the correct field. Regression test pins it.
- **Major 2** — `vscode-config.ts` reads the provider-specific key field from the
  v2 profile secret map (and the matching legacy flat key) instead of returning
  the first string; a wrong-field key (e.g. anthropic carrying only
  `openAiNativeApiKey`) is never returned.
- **Moderate 3** — `getProviderSettings` throws
  `Provider '<id>' does not support a base URL`; run.ts exits with that message.
- **Moderate 4** — persisted/CLI id `tumble` is accepted again and mapped to
  `openrouter` settings (`providerIdAliases`), re-listed in README.
- **Moderate 5** — run.ts only calls `saveSettings` when provider/model/baseUrl
  actually changed; `saveSettings` itself also skips identical rewrites.
- **Nit 8** — mistral already maps `mistralCodestralUrl` (schema + handler);
  `MISTRAL_BASE_URL` documented; test pins it.
- **Nit 10** — verified: the extension handler reads `options.apiModelId` for
  openai-native and profile ownership lists `apiModelId`; the CLI map is
  correct (`apiModelId`), pinned by test.

### Decision 3 update (default provider)

The target default is **OpenAI-compatible (`openai`)** — a local llama.cpp /
vLLM endpoint via custom `--base-url`, not a hosted router. The current shipped
fallback in `DEFAULT_FLAGS` is still `openrouter`; switching it to `openai`
(with local-model defaults) is a follow-up, not part of the review-fixes commit.

### Verification

- `cd apps/cli && npx vitest run` — full CLI suite passes (527 tests).
- `cd apps/cli && npx tsup` — build + DTS succeed.
- `npx eslint src --ext .ts --max-warnings=0` — clean.
