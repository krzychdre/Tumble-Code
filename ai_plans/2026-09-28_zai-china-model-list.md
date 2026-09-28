# Z.ai "China API" line: the settings UI showed the international model list

Branch `fix/zai-china-model-list`, from main 0869d6e75. Found while analysing S4 slice d (sharing one model
resolver between the webview hook `useSelectedModel` and the host resolvers in `provider-model-selection.ts`):
divergence 3 of that analysis. Owner decision: fix it as its own bug-fix PR before slice d.

## 1. Symptom

With the Z.ai provider and the API line "China API" (`zaiApiLine: "china_api"`), the settings model panel and the
chat header show the international model list's data, while the requests run against the mainland list. The user
sees prices and context windows other than the ones the request (and the recorded cost) uses.

## 2. Evidence

### 2.1 The data (packages/types)

`zaiApiLineSchema` (`provider-config/configs.ts`) has four lines. `zaiApiLineConfigs` (`providers/zai.ts`) gives
each a base URL and an `isChina` flag:

| line                   | base URL                                    | isChina |
| ---------------------- | ------------------------------------------- | ------- |
| `international_coding` | https://api.z.ai/api/coding/paas/v4         | false   |
| `china_coding`         | https://open.bigmodel.cn/api/coding/paas/v4 | true    |
| `international_api`    | https://api.z.ai/api/paas/v4                | false   |
| `china_api`            | https://open.bigmodel.cn/api/paas/v4        | true    |

An unset line means `international_coding` (the handler's base URL fallback and the descriptor's `defaultValue`).

The two lists differ materially (compared field by field with a tsx script over `internationalZAiModels` and
`mainlandZAiModels`): 17 of 18 shared ids have other prices (e.g. `glm-4.5` input/output/cache read
0.6/2.2/0.11 international vs 0.29/1.14/0.057 mainland; `glm-5.3` 1.4/4.4/0.26 vs 1.14/4/0.29), 9 have another
context window (200000 vs 204800), and `glm-4-32b-0414-128k` exists only in the international list.

### 2.2 Request side (the one that decides what the user pays for)

`src/api/providers/zai.ts`: `ZAiHandler` takes `models`, `defaultModelId` and `unknownModelPolicy` from
`zaiModelCatalog(options)` and its base URL from `zaiApiLineConfigs[line ?? "international_coding"]`;
`resolveZAiModel` and the host's `resolvePortableProviderModel` (case `"zai"`) use the same `zaiModelCatalog`.
`zaiModelCatalog` (`provider-model-selection.ts`) chooses the list by
`zaiApiLineConfigs[line ?? "international_coding"].isChina`. So:

| line                      | request list  |
| ------------------------- | ------------- |
| unset / `international_*` | international |
| `china_coding`            | mainland      |
| `china_api`               | mainland      |

`src/api/providers/__tests__/zai.spec.ts` already pins "China API" -> `mainlandZAiModels` info. The request goes
to open.bigmodel.cn for `china_api`, so the mainland list is the correct one: the host is right.

### 2.3 Settings side (webview-ui), before the fix

Four places compared the line id with a literal instead of reading `isChina`:

- `useSelectedModel.ts`, `getProviderModelList` (the known-model check behind the "unknown model" warning):
  `zaiApiLine === "china_coding" ? mainland : international`.
- `useSelectedModel.ts`, case `"zai"` (the `info` shown by `ModelInfoView` in the settings, the context window
  in `TaskHeader`, `ThinkingBudget`, `ChatView`): same comparison.
- `providerModelConfig.ts`, `getDefaultModelIdForProvider` (the model picker's default): same comparison.
- `ApiOptions.tsx`, the provider switch's model reset: `getProviderDefaultModelId(value, { isChina: line === "china_coding" })`.

| line                      | settings list (before) | request list  | agree  |
| ------------------------- | ---------------------- | ------------- | ------ |
| unset / `international_*` | international          | international | yes    |
| `china_coding`            | mainland               | mainland      | yes    |
| `china_api`               | **international**      | mainland      | **no** |

### 2.4 Root cause

`git log -S` shows the literal comparisons were written when Z.ai had only two lines (`0e7a878fa`, "only two
coding endpoints", and later `e356d058e`/`37bfe484c` copied the pattern). Commit `f9cfc6680` ("add general API
endpoints for Z.ai provider", upstream #9894) added `international_api` and `china_api` with correct `isChina`
flags and updated the handler side's data only; it touched no webview file, so the webview's
`=== "china_coding"` checks silently classified `china_api` as international. The host never compared ids, it
read `isChina`, which is why it stayed correct.

### 2.5 Reproduction (red before the fix)

The new `useSelectedModel.spec.ts` block "Z.ai API lines use the request's model list" runs five line values
(unset and the four lines) through three checks, each against the hard-coded expected list and against
`zaiModelCatalog` (the request's rule): the default model's info, `glm-4.5`'s info, and whether
`glm-4-32b-0414-128k` is flagged unknown. On main 0869d6e75 exactly the three `china_api` cases fail
(3 failed, 79 passed); every other line passes.

The default model id is `glm-5.3` in both lists, so the wrong default was invisible; only info and the
known-model check showed the bug.

## 3. Fix

One predicate, one line-config lookup, in `packages/types/src/providers/zai.ts`:

- `getZaiApiLineConfig(line)`: the config of the configured line, or International Coding when unset.
- `isZaiChinaLine(line)`: `getZaiApiLineConfig(line).isChina`. Its doc comment says not to compare line ids.

Used by every place that picks a list or a default:

- host: `zaiModelCatalog` (which the handler, `resolveZAiModel` and `resolvePortableProviderModel` use), the handler's
  base URL (`getZaiApiLineConfig`), and the descriptor's China get-key links (`zaiChinaLines`);
- webview: `useSelectedModel` (both the list and the selected model) and `getDefaultModelIdForProvider` now call
  `zaiModelCatalog` itself, the same function the request uses; `ApiOptions` passes `isZaiChinaLine(...)` to
  `getProviderDefaultModelId`.

No `=== "china_coding"` (or any other line id literal) is left outside tests and the schema.

## 4. Tests

- `webview-ui/.../useSelectedModel.spec.ts`: the 15 cases above (red before, green after).
- `webview-ui/.../providerModelConfig.spec.ts`: `getDefaultModelIdForProvider("zai", ...)` equals
  `zaiModelCatalog(...).defaultModelId` for each of the four lines (guards a future default that differs by list).
- `packages/types/src/__tests__/zai-api-line.spec.ts`: `isZaiChinaLine` for unset and each line, unset line is
  International Coding, `isChina` agrees with the mainland host `open.bigmodel.cn` for every line (so a new line
  with a wrong flag fails), and `zaiModelCatalog` returns the list the predicate names.

Green: those three files plus `provider-forms.descriptor`, `ApiOptions*` (webview, 5 files, 271 tests),
`provider-descriptors` and `provider-models` (types, 109 with the new spec), `zai.spec.ts` and
`zai-model-limits.spec.ts` (src, 218). `tsc --noEmit` clean for packages/types, webview-ui and src; eslint
`--max-warnings=0` and prettier on the touched files.

## 5. Residual (not changed here)

The generic model picker's dropdown lists `MODELS_BY_PROVIDER.zai`, which is always the international list
(`constants.ts` says so), for every line, so on both China lines `glm-4-32b-0414-128k` is offered. Picking it
now shows the unknown-model warning on both China lines (the known-model check uses the right list after this
fix). Making the dropdown line-aware changes what the picker offers on `china_coding` too; left as its own item.
