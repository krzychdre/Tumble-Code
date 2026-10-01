# Retire the hidden gemini-cli provider

Status: done on `fix/retire-gemini-cli-provider` (simplification round 2, item A6).

## Touched files

- `packages/types/src/provider-registry.ts`: `gemini-cli` is `retired` (moved to the end of the retired list).
- `packages/types/src/provider-profile.ts`: a stored typed profile of a since-retired provider is read as an opaque
  retired profile (new, see "Saved settings").
- `packages/types/src/provider-config/{configs,index}.ts`, `provider-validation.ts`, `provider-models.ts`,
  `provider-descriptors.ts`, `provider-model-selection.ts`: the per-provider gemini-cli entries are gone
  (`geminiCliConfigSchema`, credential list, API key field, validation, model definition, descriptor, resolver case).
- `src/api/runtime-provider-registry.ts`: `providerIdsWithoutRuntimeHandler` is gone; `RuntimeProviderId` is every
  active or hidden provider. `src/api/index.ts`: no Anthropic fallback for providers without a handler.
- `webview-ui/src/components/ui/hooks/useSelectedModel.ts`, `webview-ui/src/components/settings/provider-ui-registry.tsx`
  (and the unused `"headless-provider"` reason).
- `apps/cli/src/lib/utils/provider-types.ts`, `apps/cli/README.md`: gemini-cli is no longer an "excluded" provider,
  it is rejected as retired like the others.
- Specs and snapshots listed under Tests; `.changeset/retire-gemini-cli-provider.md`.

## Problem

`gemini-cli` was a `hidden` provider (`provider-registry.ts:79`) with no runtime handler
(`src/api/runtime-provider-registry.ts:53-62`, `providerIdsWithoutRuntimeHandler`). `getExecutableProviderEntry`
(`src/api/index.ts:155-165`) then ran it on `runtimeProviderRegistry.anthropic`, so a profile naming gemini-cli sent
its requests to the Anthropic API with whatever Anthropic settings the profile carried, instead of telling the user
that the provider cannot run. The settings showed the Anthropic model list for it (`useSelectedModel.ts:291`).

## Fix

Mark it `retired`. `getExecutableProviderEntry` already throws `ProviderUnavailableError` for retired providers
("Sorry, provider "gemini-cli" is no longer supported."), the settings and chat already show the retired-provider
notice, and the CLI already rejects retired ids. The per-provider entries become dead and are deleted, the same way
the earlier retired providers (groq, vercel-ai-gateway, ...) have no entries in these tables.

## Saved settings

Retired providers' settings keys are not in the strict `providerSettingsSchema`: their profiles are stored opaque
(`{ provider: { providerId, opaqueLegacyPayload } }`, all fields kept). So `geminiCliOAuthPath` and
`geminiCliProjectId` leave the flat schema (and `GLOBAL_STATE_KEYS`), as the derivation snapshots show.

The earlier providers were already retired when the v2 profile envelope was introduced, so their profiles were
written opaque from the start. A gemini-cli profile saved since then is stored typed
(`{ provider: { providerId: "gemini-cli", config } }`). After retiring, that shape matches neither arm of
`persistedProviderProfileSchema`, and `parseProviderProfilesEnvelope` would throw, so `ProviderSettingsManager.load`
(and import) would fail for every profile, not just this one. Verified with the new spec before adding the fix
(`ZodError: invalid_union`). `persistedProviderProfileSchema` now preprocesses such a profile into the opaque form
it would be saved in today: `opaqueLegacyPayload = { apiProvider, ...config, ...shared }`. Profiles of active and
hidden providers are untouched. This also covers any provider retired in the future.

## Tests

- `src/api/__tests__/runtime-provider-registry.spec.ts`: `buildApiHandler({ apiProvider: "gemini-cli" })` throws
  the retired-provider error (failed before: it built an AnthropicHandler).
- `packages/types/src/__tests__/provider-profile.spec.ts`: an envelope with a typed gemini-cli profile next to an
  Anthropic one parses; the gemini-cli profile becomes opaque with every field kept (failed before the
  preprocess with `invalid_union`).
- Updated deliberately: registry order lists and `classifyProvider`, provider-models (honor-custom list, defaults),
  model resolution cases (types, webview), provider-definitions (`resolveProviderModel` now throws for gemini-cli),
  portable-model-resolution, provider UI registry, validation registry, providerModelConfig, CLI exclusions;
  snapshots of `provider-schema-derivation.spec.ts` and `provider-settings-arms.spec.ts` lose the gemini-cli arm and
  its two keys, and `gemini-cli` moves to the end of the provider enum.
- Run: packages/types all (772), src api registry/definitions/portable specs, `ApiRequestBuilder.provider-capabilities`,
  all of `src/core/config`, webview `components/settings`, `components/ui/hooks`, `utils` (1127 + hooks), CLI
  `provider-types.test.ts`. tsc types, src, webview, cli; eslint; prettier; knip exit 0.

## Notes / caveats

- `ProviderSettingsSchema` and the provider registry are on the "do not touch without a dedicated item" list in
  `docs/architecture.md`; this is that item, and the pinning specs were updated on purpose.
- The opaque payload of a converted profile gets `apiProvider` added (the opaque form always carries it); a stored
  typed profile has no `apiProvider` of its own.
