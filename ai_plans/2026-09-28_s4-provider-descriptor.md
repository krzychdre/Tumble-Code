# S4: provider descriptors (first slice)

Roadmap item S4 (`ai_plans/2026-09-27_simplification-roadmap.md`, section 5): "Adding a provider touches ~15
files. Generate the webview form and model helpers from one provider descriptor in `packages/types`, as tools
already do." Also closes the provider part of F4 (a "how to add a provider" page under `docs/`).

This is the first, complete slice: the descriptor table exists, the simple provider forms are generated from it,
and the webview model helpers that only restated per-provider facts are derived. No handler (`src/api`) logic
changes.

## 1. Inventory: what adding a provider touches on main (72cf78b22)

Worked example: the last provider added end to end was Poe (c3cae397a, 42 files, since retired). The code has
moved a lot since (API-7 runtime registry, provider config schemas, validation registry), so the list below was
rebuilt from today's tree with `git grep -il moonshot` (Moonshot is a typical static-list, API-key provider)
minus comments, tests and locales.

| Area           | File                                               | What the provider needs there                                                                        |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| packages/types | `providers/<id>.ts`                                | model list, default model id                                                                         |
| packages/types | `providers/index.ts`                               | barrel export                                                                                        |
| packages/types | `provider-registry.ts`                             | `providerRegistry` entry: id, lifecycle, label, order, source                                        |
| packages/types | `provider-models.ts`                               | `providerModelDefinitions` row                                                                       |
| packages/types | `provider-validation.ts`                           | `providerApiKeyFields` + `providerValidationRegistry` rows                                           |
| packages/types | `provider-config/configs.ts`                       | config schema                                                                                        |
| packages/types | `provider-config/index.ts`                         | `providerConfigSchemas` + discriminated-union arm                                                    |
| packages/types | `provider-settings.ts`                             | legacy settings arm, union member, flat schema spread                                                |
| packages/types | `global-settings.ts`                               | API key in `SECRET_STATE_KEYS`                                                                       |
| packages/types | `provider-model-selection.ts`                      | case in the model resolution switch                                                                  |
| src            | `api/providers/<id>.ts`                            | handler                                                                                              |
| src            | `api/providers/index.ts`                           | barrel export                                                                                        |
| src            | `api/runtime-provider-registry.ts`                 | factory, capabilities, `resolveModel`                                                                |
| apps/cli       | `src/lib/utils/provider-types.ts`                  | `providerEnvMap` (env var names)                                                                     |
| webview-ui     | `components/settings/providers/<Name>.tsx`         | the settings form component                                                                          |
| webview-ui     | `components/settings/providers/index.ts`           | barrel export                                                                                        |
| webview-ui     | `components/settings/provider-ui-registry.tsx`     | registry row rendering the component                                                                 |
| webview-ui     | `components/settings/ApiOptions.tsx`               | `PROVIDER_MODEL_CONFIG` row + default-model import (docs slug map when the slug differs from the id) |
| webview-ui     | `components/settings/utils/providerModelConfig.ts` | `PROVIDER_SERVICE_CONFIG` row (model picker link)                                                    |
| webview-ui     | `components/ui/hooks/useSelectedModel.ts`          | switch case + model-list import                                                                      |
| webview-ui     | `i18n/locales/*/settings.json` (18 locales)        | label and get-key link keys                                                                          |

So **20 code files** plus 18 locale files (the roadmap's "about 15" undercounted the webview helpers).

Existing tables this slice builds on rather than duplicates:

- `providerRegistry` (packages/types): portable inventory, label, lifecycle, model source.
- `providerModelDefinitions` (packages/types): model-id field, static list, default model, unknown-model policy.
- `providerApiKeyFields` / `providerValidationRegistry` (packages/types): API key field and required fields.
- the runtime provider registry with capability flags (`src/api/runtime-provider-registry.ts`, API-7):
  `RuntimeProviderEntry` = model definition + factory + `capabilities` (`allowedFunctionNames`,
  `needsModelPreload`) + `resolveModel`. Out of scope here (no handler changes).
- `SETTINGS_SCHEMA` (`webview-ui/src/components/settings/schema.ts`): the per-setting Save-buffer table for global
  settings. Provider profile fields do not go through it (they are saved as a profile), so it is untouched.

## 2. Design: `PROVIDER_DESCRIPTORS`

`packages/types/src/provider-descriptors.ts`, `as const satisfies { [P in ActiveProviderId]: ProviderDescriptor<P> }`,
so a provider added to `providerRegistry` does not compile until it has a row (the `TOOL_DESCRIPTORS` pattern).

A row holds only the facts that had no table yet:

- `form`: `{ kind: "fields", fields }` (rendered generically), `{ kind: "custom" }` (hand-written component) or
  `{ kind: "none" }` (hidden providers `fake-ai`, `gemini-cli`).
- field kinds:
    - `apiKey`: label key, get-key link text key, get-key URL (fixed, or `{ field, byValue, otherwise }` when it
      depends on the chosen endpoint). The settings key is NOT repeated: it is `providerApiKeyFields[id]`, and the
      row type forbids an `apiKey` field for a provider whose entry there is null (checked with a
      `@ts-expect-error` case in the spec).
    - `select`: settings key, label key, optional description key, optional default value, options.
    - `optionalUrl`: settings key, toggle label key, placeholder key ("use custom base URL" checkbox + URL field).
- `service`: model picker name and link (replaces `PROVIDER_SERVICE_CONFIG`).
- `docsSlug`: docs page (replaces the slug exception map in `ApiOptions`).

Label, model source, default model id and model list are deliberately not copied into the row: they already live
in typed tables keyed the same way, and copying them would create the drift S4 is meant to remove. The type
helpers `DescriptorFormProviderId`, `CustomFormProviderId`, `NoFormProviderId` are derived from the table, and
`provider-ui-registry.tsx` is keyed by them: descriptor forms are generated from `getDescriptorFormProviderIds()`,
custom rows must cover exactly the `custom` providers, and no-form rows exactly the `none` providers.

## 3. Webview: generic form and derived helpers

- `webview-ui/src/components/settings/providers/ProviderDescriptorForm.tsx` renders the fields with the same
  building blocks the components used (`ApiKeyField`, `ThemedDropdown`, `ThemedTextField`, the checkbox). The API
  key trio is "grouped" (its own `<div>`, no negative margin) when it is not the first field, which matches every
  migrated component.
- Migrated and deleted: `XAI.tsx`, `DeepSeek.tsx`, `Gemini.tsx`, `Moonshot.tsx`, `MiniMax.tsx`, `ZAi.tsx` (and
  `providers/__tests__/Gemini.spec.tsx`, whose two assertions the new characterization spec covers).
- Not migrated (custom logic): Anthropic (auth-token toggle, 1M-context checkbox by model), Mistral (Codestral URL
  shown by model id), OpenAI native (service tier by model), Bedrock, Vertex, OpenRouter, LiteLLM, Ollama,
  LM Studio, OpenAI Compatible, OpenAI Codex (OAuth + dashboard), Qwen Code (OAuth path with blur default),
  VS Code LM.
- `ApiOptions.onProviderChange`: the hand-written `PROVIDER_MODEL_CONFIG` map (18 rows + 16 default-id imports) is
  replaced by `providerModelDefinitions[id].modelIdField` + `getProviderDefaultModelId(id, { isChina })`; VS Code
  LM (selector object, not an id) is skipped as before.
- `ApiOptions` docs link: slug from the descriptor.
- `getProviderServiceConfig`: from the descriptor; `PROVIDER_SERVICE_CONFIG` removed.
- `useSelectedModel`: the eight identical "`apiModelId ?? default`, look up in the static list" cases (xAI, Gemini,
  Moonshot, MiniMax, OpenAI native, Mistral, Qwen Code, OpenAI Codex) fold into the `default` branch reading
  `providerModelDefinitions`; Anthropic, `gemini-cli` and `fake-ai` get explicit cases.

After the slice, a static-list API-key provider whose settings fit the field kinds touches **15 code files**
(the 14 non-webview files above plus its `PROVIDER_DESCRIPTORS` row) and the locale files; the six webview files
drop to zero.

## 4. Equivalence evidence

Commit 1 (characterization, green on main before any change):

- `provider-forms.descriptor.spec.tsx`: 16 DOM snapshots (useId values normalized) of the six forms in empty,
  key-set and alternative-endpoint configurations, plus what each dropdown option, API key field and the Gemini
  toggle writes. The snapshots are unchanged after the move (no snapshot written or updated).
- `ApiOptions.spec.tsx`: model field and default set when switching to each of the 19 selectable providers, the
  Z.ai mainland default, keep-valid and fetched-list cases, and the docs URL of every provider.
- `providerModelConfig.spec.ts`: service name/link for all 21 providers.
- `useSelectedModel.spec.ts`: default / listed / unknown / empty id for the eight folded providers.

Pre-existing tables (`provider-forms.table.spec.tsx`, `provider-ui-registry.spec.tsx`, `dropdown.call-sites.spec.tsx`)
also pass unchanged apart from the call-sites spec rendering `ProviderDescriptorForm` instead of the deleted
components.

Known, intended edge differences (not reachable from normal settings):

- Z.ai with a stored `zaiApiLine` outside the four known values: the old form crashed reading
  `zaiApiLineConfigs[value].isChina`; the descriptor falls back to the international key link.
- `useSelectedModel` for the folded providers uses `Object.hasOwn`, so an id like `toString` no longer resolves to
  an `Object.prototype` member as info.
- `onProviderChange` would now initialize `gemini-cli` to its definition default; `gemini-cli` is hidden and never
  offered by the provider picker.

## 5. Later slices

- Fold `provider-model-selection.ts`'s switch and the remaining `useSelectedModel` cases into
  `providerModelDefinitions` resolution (one resolver shared by host and webview).
- `getProviderModelSourceOptions` (fetched lists) as descriptor data (which settings keys feed `baseUrl`/`apiKey`).
- More field kinds (a model-dependent visibility rule would cover Mistral's Codestral URL; a checkbox kind with
  "clear these keys on untick" would cover Anthropic's and OpenAI native's base URL blocks).
- Generate `PROVIDERS_WITH_CUSTOM_MODEL_UI` from the descriptor (`modelPicker: "generic" | "in-form"`).
- The settings-schema arms (`provider-config`, `provider-settings`, `SECRET_STATE_KEYS`) are the largest remaining
  manual part and touch the do-not-touch flat schema; a separate, careful item.
