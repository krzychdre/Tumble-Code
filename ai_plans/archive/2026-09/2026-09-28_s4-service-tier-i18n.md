# S4 clean-up, slice a: translate the service tier field

Continues the S4 provider descriptor work (`ai_plans/2026-09-28_s4-provider-descriptor.md`, `-slice2.md`,
`-slice3.md`). Slice 3 recorded as a residual: "The service tier label and tooltip are untranslated English, as
before the move; translating them means i18n keys in all locales (a visible change, its own item)." This is that
item. Branch `refactor/s4-service-tier-i18n`, from main d98e267b0.

## 1. Problem

The OpenAI native form's service tier dropdown (the `modelTierSelect` field of the `openai-native` descriptor row)
was the only descriptor field with literal English text: the label "Service tier", the info tooltip and the option
texts "Standard", "Flex", "Priority". Every other field kind takes i18n keys. So the field showed English in all 18
locales, and the field kind itself had a different shape from its siblings (`label` instead of `labelKey`).

## 2. Approach

- `ProviderModelTierSelectFieldDescriptor`: `label` -> `labelKey`, `tooltip` -> `tooltipKey`, option and base option
  `label` -> `labelKey`. The generic form passes them through `t()` like the other kinds.
- Option texts reuse the existing, already translated `settings:serviceTier.standard|flex|priority` keys (the
  pricing table in `ModelInfoView` uses them), so the dropdown and the pricing table name the tiers the same way.
- Two new keys, `settings:serviceTier.label` and `settings:serviceTier.tooltip`, added to all 18 locales. The
  English values are the former literal strings, character for character.

## 3. Equivalence evidence (English)

- `provider-forms.openai-native.spec.tsx` (slice 3's characterization spec): its translation mock now resolves the
  `settings:serviceTier.*` keys from the real `en/settings.json` (all other keys still render as themselves). The 9
  DOM snapshots and the option-text assertions ("Standard", "Flex", "Priority", picking by option name) pass with no
  snapshot written or updated, so the English DOM is unchanged.
- Other locales now show their translation: the intended, visible part of the change (changeset
  `s4-service-tier-i18n`).

## 4. New guard

`webview-ui/src/components/settings/__tests__/provider-descriptors.i18n.spec.ts` walks `PROVIDER_DESCRIPTORS`,
collects every `settings:` string and checks it exists as text in every locale's `settings.json`. Before, a
descriptor key typo or a key missing in one locale would only show as the raw key in the UI (the
`find-missing-translations` script compares locales with `en`, not code with `en`).

Checks run: the two specs above, `provider-forms.*`, `provider-ui-registry`, `ModelInfoView` specs (170 tests),
`provider-descriptors.spec.ts` (types), `tsc` for webview-ui and packages/types, `find-missing-translations.js
--area=webview`, `find-unused-i18n-keys.mjs` (0 unused).

## 5. Residuals

None for this item. The other S4 residuals (behaviour field kinds, schema arms, model selection) are separate
slices.
