# S4 slice 2: model-dependent fields, clearing checkboxes, model picker and model source as descriptor data

Continues `ai_plans/2026-09-28_s4-provider-descriptor.md` (slice 1, PR #572), items from its "Later slices" list.
Branch `refactor/s4-provider-descriptor-slice2`, from main 8a9893d2e. No `src/` changes (another helper owns the type
cleanup there) and no changes to the settings Save-buffer plumbing from D13 (#585).

## 1. Scope, in the order asked

1. New field kinds, then the providers they unlock:
    - model-dependent visibility (`visibleWhen`) on every field kind: `{ modelIdStartsWith }` or `{ modelIdIn }`;
    - `checkbox` (boolean setting, optional note);
    - `url` (labelled URL field with a literal example placeholder and an optional note);
    - `optionalUrl` extended: `alsoClear` (settings written after the URL is cleared on untick), `revealedFields`
      (checkboxes shown under the URL while ticked), a literal `placeholder` as an alternative to `placeholderKey`,
      and `toggleTestId` (the test id Gemini's checkbox had, which Anthropic's never had).
    - Migrated: **Mistral** (API key + Codestral URL shown for `codestral-` models) and **Anthropic** (API key +
      custom base URL whose untick also resets the auth-token switch, the auth-token switch under the URL, and the
      1M context checkbox for the four models with that tier). Both components are deleted.
    - Not migrated: **OpenAI native**. Its custom base URL block is covered by the new `optionalUrl`, but the form
      also has the service-tier select whose options come from the selected model's `tiers` (not a fixed list), and
      its checkbox sits outside a wrapper `<div>` above the API key (a different DOM from the Gemini/Anthropic
      layout). Both would need their own kinds; left custom.
2. `PROVIDERS_WITH_CUSTOM_MODEL_UI` derived from `modelPicker: "in-form"` rows; `getProviderModelSourceOptions`
   derived from `modelSourceOptions` rows (a typed map from each `ModelSourceOptions` option to a `ProviderSettings`
   key whose value type fits it).
3. `useSelectedModel`: only the Anthropic 1M model list is now shared (`ANTHROPIC_1M_CONTEXT_MODEL_IDS`, exported
   from `provider-model-selection.ts`, used by the host selector, the descriptor rule and the webview hook). The
   other branches are not "straightforward as data" (see section 5) and stay.

## 2. Design notes

- `resolveProviderFormModelId(provider, settings)` (packages/types): the configured id from the provider's
  `modelIdField`, or its `defaultModelId` when the id is unset **or empty**. That is the rule `resolveCatalogModel`
  applies for the request (`if (!modelId) return default`), so a model-dependent field follows the model the
  request actually uses. The generic form computes it once and skips fields whose `visibleWhen` does not match.
- The old Anthropic form read `useSelectedModel(apiConfiguration).id` (`apiModelId ?? default`) and the old
  Mistral form `apiModelId?.startsWith(...) || (!apiModelId && default.startsWith(...))` (`apiModelId || default`).
  The new rule is `||` for both. The only input where `??` and `||` differ is an empty id; for Anthropic the default
  (`claude-opus-5`) has no 1M tier, so both rules hide the checkbox and the result is the same. The characterization
  spec pins the empty-id case for both providers.
- The generic form no longer calls `useSelectedModel` for Anthropic (it ran the model-list hooks just to read the
  id); the table spec mocks that hook, the new spec does not.
- Row types: `ProviderBooleanSettingKey` for checkboxes; `alsoClear` is `Partial<ProviderSettings>`; nested
  checkboxes cannot carry a note or their own rule (the type omits them).
- `getInFormModelPickerProviderIds()` and `resolveProviderModelSourceOptions(settings)` live next to the table; the
  webview keeps the old exported names (`PROVIDERS_WITH_CUSTOM_MODEL_UI`, `getProviderModelSourceOptions`) as
  thin derivations, so their importers (`ApiOptions`, `useSelectedModel`) are unchanged.
- Spec guards in `provider-descriptors.spec.ts`: model rules only on providers whose model id is `apiModelId` from
  a static list; `modelSourceOptions` only on providers with a `modelSource`.

## 3. Equivalence evidence

Commit 1 (characterization, green on main before any change):

- `webview-ui/src/components/settings/__tests__/provider-forms.model-rules.spec.tsx`: 11 DOM snapshots of the
  Anthropic and Mistral forms (with the real checkbox, so class names and the absence of a test id are pinned),
  visibility of the Codestral URL (6 cases incl. unset, empty, unlisted `codestral-` id, `my-codestral-latest`) and
  of the 1M checkbox (8 cases incl. unset, empty, each 1M model, a listed model without the tier, an unlisted id),
  and what each control writes, including the untick order `anthropicBaseUrl ""` then
  `anthropicUseAuthToken false`.
- `webview-ui/src/components/settings/utils/__tests__/providerModelConfig.spec.ts`: exact
  `PROVIDERS_WITH_CUSTOM_MODEL_UI`, `shouldUseGenericModelPicker` for all 21 providers, and
  `getProviderModelSourceOptions` for all 21 providers against a settings object where every candidate key has a
  distinct value, plus the "unset key stays an undefined property" shape.

Commit 2 (the move): every spec above passes with no snapshot written or updated (`provider-forms.model-rules`,
`provider-forms.descriptor`, `provider-forms.table`, `provider-ui-registry`, `providerModelConfig`,
`dropdown.call-sites`, `useSelectedModel`, `useProviderModels`, `ApiOptions`, `ApiOptions.provider-filtering`);
`provider-descriptors.spec.ts` gains the two new generic-form providers and tests for the new helpers.

## 4. Adding a provider after this slice

A static-list provider whose settings are an API key, endpoint choice, URL fields, base-URL toggles and
checkboxes, even model-dependent ones, still needs zero webview files. A fetched-list provider now declares its
picker placement and request keys in its row instead of editing `providerModelConfig.ts`. `docs/10-adding-things.md`
lists the kinds.

## 5. What remains (next slices)

- OpenAI native: a `select` whose options come from the model's `tiers` and a layout variant for the checkbox
  outside a group; then the component can go.
- Other custom forms (Bedrock, Vertex, OpenRouter, LiteLLM, Ollama, LM Studio, OpenAI Compatible, OpenAI Codex,
  Qwen Code, VS Code LM) have OAuth flows, fetched lists, credentials or file pickers: they stay custom.
- `useSelectedModel` branches: Anthropic/Bedrock/Vertex 1M tiers, Z.ai lines, DeepSeek aliases and the local
  lists. The host resolvers in `provider-model-selection.ts` already express most of this, but they give an
  unknown id guessed info (`honor-custom`) while the webview returns `undefined` info to flag the unknown model;
  sharing one resolver needs that difference decided first. Not a data move, so not done here.
- `ProviderFormId` in `provider-ui-registry.tsx` still lists the custom form ids by hand (they differ from the
  provider ids for `openai` -> `openai-compatible`).
- The settings-schema arms (`provider-config`, `provider-settings`, `SECRET_STATE_KEYS`), as in slice 1.
