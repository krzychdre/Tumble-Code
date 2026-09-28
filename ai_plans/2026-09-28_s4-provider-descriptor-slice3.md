# S4 slice 3: model tier select, flat layout, OpenAI native as descriptor data, derived form ids

Continues `ai_plans/2026-09-28_s4-provider-descriptor.md` (slice 1) and
`ai_plans/2026-09-28_s4-provider-descriptor-slice2.md` (slice 2), items from slice 2's "What remains" list.
Branch `refactor/s4-provider-descriptor-slice3`, from main 996fd30db. No `src/` changes.

## 1. Scope, in the order asked

1. New field kinds and options, then the provider they unlock:
    - `modelTierSelect`: a dropdown whose options come from the selected model's info. A `baseOption` is always
      offered (and shown while the setting is unset); each entry of `options` is offered only when the selected
      model's `tiers` contain a tier with that name, in the order the row lists them; with no such tier the field
      is not rendered. Label and tooltip are literal text (the old component's English strings had no i18n keys;
      translating them is a separate, visible change). Option values are typed `ServiceTier`.
    - `grouped: false` on `apiKey` and `optionalUrl`: the controls go directly into the form instead of their own
      `<div>` group. This is the "checkbox above the API key" layout of the OpenAI form, where both the base-URL
      checkbox and the API key trio are flex children of the form (the trio keeps the negative top margin that
      compensates for the form's gap, exactly as the old component rendered it).
    - Migrated: **OpenAI native** (optional base URL, API key, service tier). `providers/OpenAI.tsx` is deleted.
2. `ProviderFormId` in `provider-ui-registry.tsx` is derived: `CustomFormProviderId | DescriptorFormProviderId`
   (both from `PROVIDER_DESCRIPTORS`) mapped through `customFormIdAliases = { openai: "openai-compatible" }`, the
   only custom form named differently from its provider. Custom rows use `customForm(provider, render)`, which
   computes the id, so the id is no longer written twice per row.
3. Other hand-written forms: checked, none is covered by the kinds without custom logic. Bedrock, Vertex,
   OpenRouter, LiteLLM, Ollama, LM Studio, OpenAI Compatible, OpenAI Codex, Qwen Code and VS Code LM have OAuth
   flows, fetched model lists, cloud credentials, file pickers or model selectors inside the form (as listed in
   slice 2), so they stay custom.

## 2. Design notes

- Where the model info comes from: the old component read `selectedModelInfo` from the registry render context
  (`useSelectedModel` in `ApiOptions`, rule `apiModelId ?? default`). The descriptor form now receives the same
  prop and passes it to `modelTierSelect`; it does not recompute the info from `resolveProviderFormModelId`
  (rule `||`), because that would show the default model's tiers for an empty model id, where the old form
  showed none. Keeping the context value makes the move exact.
- Old filter: tier names, drop empty ones, keep only `flex`/`priority`, then render Standard, Flex (if present),
  Priority (if present). New: filter the row's options (`flex`, `priority`) by the model's tier-name set. Same
  set and same order; a `default`-named or unnamed tier still shows nothing.
- `provider-descriptors.spec.ts` gains a guard: every `modelTierSelect` option must be a tier some model in the
  provider's static list has, options are unique and the base option is not among them.

## 3. Equivalence evidence

Commit 1 (characterization, green on main before any change):

- `webview-ui/src/components/settings/__tests__/provider-forms.openai-native.spec.tsx`: 9 DOM snapshots through
  `renderProviderForm` with the real checkbox and the real Radix dropdown (empty, key set, stored base URL,
  flex+priority with tier unset and with priority chosen, flex only with flex chosen, priority only, no tiers,
  unnamed/default tiers only), and 15 interaction cases: tick writes nothing and reveals the URL with its
  placeholder, untick writes `openAiNativeBaseUrl ""` only, the API key writes `openAiNativeApiKey`, the tier
  field is hidden for four inputs without usable tiers, the offered options in order for four tier sets
  (including priority listed before flex), and each pick (Standard writes `"default"`). 24 tests.

Commit 2 (the move): the spec above passes with no snapshot written or updated, as do
`provider-forms.descriptor`, `provider-forms.model-rules`, `provider-forms.table`, `provider-ui-registry`
(including the `openai-native` and `openai-compatible` form ids), `providerModelConfig`, `dropdown.call-sites`,
`ApiOptions` and `ApiOptions.provider-filtering` (9 files, 336 tests), and `provider-descriptors.spec.ts` in
packages/types (18 tests).

## 4. Adding a provider after this slice

A static-list provider whose settings are an API key, endpoint choice, URL fields, base-URL toggles, checkboxes
and a choice among the selected model's tiers needs zero webview files; `docs/10-adding-things.md` lists the kinds
and the `grouped: false` layout option. A custom form's id no longer needs to be added to a hand-written union.

## 5. What remains (next slices)

- The remaining custom forms (listed in 1.3) stay custom; any further migration needs kinds for fetched model
  lists, OAuth sign-in or credential files, which are behaviour, not layout.
- The service tier label and tooltip are untranslated English, as before the move; translating them means i18n
  keys in all locales (a visible change, its own item).
- `useSelectedModel` branches and the host resolvers in `provider-model-selection.ts` (unchanged from slice 2's
  list: the unknown-model info difference must be decided first).
- The settings-schema arms (`provider-config`, `provider-settings`, `SECRET_STATE_KEYS`), as in slices 1 and 2.
