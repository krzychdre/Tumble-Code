# S4 clean-up, slice b1: a fetched-model picker field kind, LM Studio as descriptor data

Continues the S4 provider descriptor work (`ai_plans/2026-09-28_s4-provider-descriptor.md`, slices 2 and 3, and
this round's `-service-tier-i18n.md` and `-schema-arms.md`). Slice 3 left as a residual: "the remaining custom forms
stay custom; any further migration needs kinds for fetched model lists, OAuth sign-in or credential files, which are
behaviour, not layout." This slice adds the first behaviour kind, for fetched model lists, and migrates the form it
makes expressible. Branch `refactor/s4-fetched-model-picker`, from main d49620cab.

## 1. Problem

LM Studio and Ollama had hand-written forms mostly to do one thing the descriptor form could not: request the
provider's model list from the local server and let the user pick from it inside the form (with a warning when the
configured model is not on the server). A new provider of that shape (a local or self-hosted server with a model
list endpoint) needed its own component, index export and registry row.

## 2. Approach

New field kinds and options in `PROVIDER_DESCRIPTORS` (packages/types), rendered by `ProviderDescriptorForm`:

- `fetchedModelPicker` (behaviour): `key` (a `ModelIdKey`), optional `labelKey`, `hidePricing`. When a row has one,
  the form requests the provider's list once (`useProviderModels(provider, resolveProviderModelSourceOptions(...))`,
  the options named by the row's `modelSourceOptions`, so the query key is the one the component used) and hands it
  to every picker field. Each picker gets `defaultModelId ""`, the row's `service` name and link, and the
  `settings:validation.modelAvailability` error when a configured id is missing from a non-empty list (the `in`
  check the components used, unchanged).
- `text`: a labelled text field (`inputType` url/password or plain, placeholder key or literal, optional help text
  inside the field).
- `note`: a description-colour text; `links` renders tags of the translation as links and `warningTag` renders one
  tag as the bold error-colour "Note:" label (the exact element the component passed to `Trans`).
- `checkbox` gains `grouped: false` (no wrapping `<div>`).
- `visibleWhen` gains a setting rule, `{ settingIsSet: key }` (truthy), beside the model rules;
  `matchesProviderFieldRule` / `isProviderModelRule` in packages/types.

Mount semantics: a form with a fetched picker renders through `FetchedModelsForm`, keyed by provider, so switching
between two such providers mounts a fresh form, as switching between two hand-written components did; other
descriptor forms render the same tree as before (one extra component level, no DOM change).

Migrated: **LM Studio** (base URL, model picker, speculative decoding checkbox, draft model picker and its note while
the checkbox is on, the description with its two links and the "Note:" label). `providers/LMStudio.tsx` is deleted,
with its index export, registry row and its entry in `react-compiler-bailouts.json` (the old component was a React
Compiler bailout; the generic form compiles, which only adds memoization).

## 3. Equivalence evidence

Commit 1 (characterization, green on main before any change):
`webview-ui/src/components/settings/__tests__/provider-forms.local-models.spec.tsx`, covering LM Studio and Ollama
(Ollama moves in the next slice): 14 DOM snapshots through `renderProviderForm` with the real checkbox, a
`ModelPicker` stub that prints all non-function props (so every prop the form passes is pinned) and a `Trans` stub
that renders its key and every component it is given (link targets, warning element); the model list request
arguments, including their serialized form (the query key); the availability error for 10 inputs (unset, listed,
unlisted, empty list, nothing fetched, `toString`); and what the base URL, speculative decoding, API key and
`num_ctx` controls write. 39 tests.

Commit 2 (the move): the spec passes with no snapshot written or updated. Also green: all `provider-forms.*`,
`provider-ui-registry`, `provider-descriptors.i18n`, `ApiOptions*`, `providerModelConfig`, `useProviderModels`,
`useSelectedModel`, `ModelPicker*`, the UI call-site specs (42 files, 647 tests), `validate` and
`provider-validation-registry` (61), `provider-descriptors.spec.ts` (21), `tsc` for packages/types and webview-ui,
eslint with `--max-warnings=0`, the React Compiler bailout check and the radius check.

New guards in `provider-descriptors.spec.ts`: a `fetchedModelPicker` only in a row with a registry `modelSource`,
`modelSourceOptions`, `service` and `modelPicker: "in-form"`; a setting rule only points at a setting a field of the
same form writes; the model-rule guard ignores setting rules.

## 4. Adding a provider after this slice

A provider whose form is "base URL (and key), pick a model from the server's list, a few switches and notes" is a
descriptor row: no component, no registry row, no index export. `docs/10-adding-things.md` lists the new kinds.

## 5. Residuals

- Ollama needs two more pieces (an integer field for `num_ctx` with its parse rule, and a note with a trailing
  warning); next slice.
- OpenRouter, LiteLLM, OpenAI Compatible and VS Code LM also pick from fetched lists but have more behaviour
  (OAuth key link and balance, a refresh button with status, custom model info, selector transforms, allow-list
  filtering, `simplifySettings`); the picker kind does not pass those props yet.
