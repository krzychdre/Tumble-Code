# S4 slice d: one model resolver for the request and the settings UI

Last S4 item (generate provider forms and model helpers from `PROVIDER_DESCRIPTORS`): unify the webview hook
`useSelectedModel` (webview-ui) with the host resolvers in `packages/types/src/provider-model-selection.ts`.
Listed as open in `ai_plans/2026-09-28_s4-provider-descriptor-slice2.md` and `...-slice3.md` section 5 ("the
unknown-model info difference must be decided first"). Branch `refactor/s4-model-resolution`, from main ec73ad69a
(after the Z.ai fix, PR #626).

## 1. Owner decisions (verbatim)

- Divergence 1: NO visible change. Implement a shared resolver returning `{ id, info, known }` (or equivalent);
  the host keeps guessing info for unknown ids; the webview maps `known: false` to `undefined` info so the
  warning stays.
- Divergence 2: keep BOTH current behaviours unchanged (webview keeps "", host falls back to default). Express it
  explicitly (a policy/option), with a test for each side.
- Divergence 3: FIX IT, as a separate bug-fix PR with its own test, BEFORE slice d.

Divergence 3 (Z.ai "China API" line showing the international list in the settings) was fixed in PR #626,
`ai_plans/2026-09-28_zai-china-model-list.md`.

## 2. Where the shared resolver lives

`packages/types` (`@roo-code/types`): both the webview and the extension already import it (the webview hook
already used `ANTHROPIC_1M_CONTEXT_MODEL_IDS` and `zaiModelCatalog` from this file), it has no dependency on
either side, and `src/__tests__/layering.spec.ts` only constrains imports inside `src/`. No cross-workspace
relative import is added.

## 3. Design

`resolveProviderModelSelection(settings, { fetchedModels, emptyModelId })` returns
`ProviderModelResolution = { id, info, known }` (the existing `CatalogModelResolution` of `resolveCatalogModel`),
or `undefined` for Bedrock, fake-ai and providers this version cannot run (as before).

- `known: false` means the provider has a model list and the id is not in it (or is an empty id kept by
  `keep-empty`); `info` is then the stand-in the request uses: the default model's info (keep-id policy), a guess
  from the id (Anthropic's `guessAnthropicModelInfo`, Gemini's unpriced default), or the provider's fallback
  (OpenRouter, LiteLLM, Ollama, LM Studio). Providers without a list (OpenAI Compatible, VS Code LM) are always
  known. This is divergence 1: the host keeps its guess, the settings map `known: false` to `undefined`.
- `emptyModelId: "default-model" | "keep-empty"` (default `"default-model"`): what an empty (`""`) id selects on a
  provider with a static list. The request uses `"default-model"` (the `if (!modelId) return default` rule of
  `resolveCatalogModel`); the settings pass `"keep-empty"` (the id stays `""` with no info), except DeepSeek, whose
  settings always used `||` and showed the default. Providers with a fetched list or user-configured info have
  their own empty-id rule and ignore the policy. This is divergence 2.
- The host adapters are unchanged in output: `resolvePortableProviderModel(settings, fetched)` is the resolver
  with the default policy (the CLI's context gauge and `portable-model-resolution.spec.ts` read it);
  `selectAnthropicModel`, `selectAnthropicVertexModel` and `selectGeminiModel` (used by the handlers) call the
  same internal functions (`resolveAnthropicModel`, `resolveAnthropicVertexModel`, `resolveGeminiModel`,
  `resolveFromCatalog`) with `"default-model"`.
- The webview adapter (`getSelectedModel` in `useSelectedModel.ts`) calls the resolver for every static-list
  provider (Anthropic, Gemini, Vertex, Z.ai, DeepSeek, xAI, Mistral, Moonshot, MiniMax, OpenAI native, OpenAI
  Codex, Qwen Code), LiteLLM and OpenAI Compatible, and returns `info` only when `known` (LiteLLM keeps its
  stand-in, as it always showed it). `settingsForSharedResolver` states the two places the settings resolve a
  provider unlike its request (section 5).

Before, the webview repeated each rule: its own Anthropic and Vertex 1M tier code, Z.ai list choice, DeepSeek
alias table, OpenAI Compatible fallback, LiteLLM fallback and a static-list lookup, next to the host's copies.

## 4. Equivalence evidence

Commit 1 and 1b (characterization, no production change, green on main ec73ad69a):

- `packages/types/src/__tests__/provider-model-resolution.spec.ts`: 44 cases of `resolvePortableProviderModel`
  (id and info) for known, unknown, empty and unset ids: xAI; Anthropic (listed, 1M tier, unknown with default
  info without prices, unknown naming a known model, empty); gemini-cli with the 1M flag; Gemini (unknown, empty);
  Vertex (Claude with 1M, Gemini, unset with 1M, unknown, empty); Z.ai mainland; DeepSeek (alias, fetched-only
  id, empty); OpenRouter, LiteLLM, Ollama (num_ctx not applied), LM Studio (known, unknown, empty, unset);
  OpenAI Compatible; VS Code LM; Bedrock and fake-ai (`undefined`).
- `webview-ui/src/components/ui/hooks/__tests__/useSelectedModel.resolution.spec.ts`: 51 cases of
  `useSelectedModel` (id, info, `isUnknownModel`) for the same profiles plus gemini-cli unknown, fake-ai,
  OpenRouter with an endpoint, Ollama num_ctx cap, LM Studio default-info merge, VS Code LM selector and unset,
  Bedrock (listed, custom ARN, unknown, empty).

Commit 2 (the resolver): the two files pass with no case changed (`git diff` of the case tables since commit 1b
has no removed line); new tests are appended: on the host side, `resolvePortableProviderModel` equals the
resolver with the default policy for all 44 profiles, empty ids per policy on six static-list providers, the four
providers that ignore the policy, unknown ids keep stand-in info with `known: false`, and listed, aliased,
fetched and list-less ids are known (107 tests); on the settings side, one test per decision ties the resolver's
output to what the hook shows (53 tests).

Also green: all webview specs under `components/ui/hooks`, `components/settings` (forms, `ApiOptions*`,
`ModelPicker*`, `ThinkingBudget`, `providerModelConfig`) and `TaskHeader`, `ChatView`, `ErrorRow`
(53 files, 943 tests); src `portable-model-resolution`, `runtime-provider-registry`, `anthropic`,
`anthropic-vertex`, `vertex`, `gemini`, `zai` handler specs (7 files, 227 tests); the CLI's
`context-window.test.ts` (11). `tsc --noEmit` clean for packages/types, webview-ui, src and apps/cli; eslint
`--max-warnings=0` and prettier on the touched files; `pnpm knip` exit 0.

One behaviour moves that no real profile reaches: the old webview indexed the Anthropic, Vertex and Z.ai lists
with `models[id]` (no own-property check), so an id named after an `Object.prototype` member (`"constructor"`)
returned a function as model info while `isUnknownModel` was already true. The shared resolver checks
`Object.hasOwn`, so such an id now shows no info, consistent with its warning.

## 5. What stays separate, and why

Kept in `useSelectedModel` (each one shows something the request does not compute, so sharing would be a visible
change; owner rule "leave that branch in place, document it"):

- OpenRouter: the chosen endpoint's info merged over the model's, no info for an unlisted id, and `||` (an empty
  id shows the default) where the request uses `??` (an empty id is kept, with the default info).
- Bedrock: the `custom-arn` pseudo model with fixed info and a flat 1M window; the request resolves Bedrock in its
  handler (custom ARN parsing, family guess), which the portable resolver never covered.
- Ollama: the window capped at `ollamaNumCtx`, no info for an unlisted id (request: sane defaults, no cap).
- LM Studio: the fetched info merged over `lMStudioDefaultModelInfo` (request: the fetched info alone).
- VS Code LM: the id is `vendor/family` from the selector and the info comes from `vscodeLlmModels` (request:
  id `"vscode-lm"`, sane defaults).

Shared, but the settings pass a different profile (`settingsForSharedResolver`), because the two sides disagree
and changing either is visible:

- gemini-cli and fake-ai: the settings show the plain Anthropic list without the 1M tier; the request runs
  gemini-cli on the Anthropic handler, which applies `anthropicBeta1MContext` if a profile carries it. fake-ai
  has no request-side resolution.
- Vertex with an unset id: the settings route the default model (a Claude id) as that id and show its 1M tier;
  the request routes by the configured id (`isVertexClaudeModel` is false), builds the Gemini `VertexHandler`
  and applies no tier. Pinned on both sides ("vertex unset with 1M").

Found dead and removed: the webview's DeepSeek branch read `routerModels.deepseek`, but DeepSeek's model source is
`static` (`getProviderModelSource` checks the static list first), so the hook never fetches a list for it; the
characterization pins that an id only a fetched list has is unknown. (`getProviderModelList` still spreads the
hook's `dynamicModels` for DeepSeek, which is always undefined there; left, it only feeds the warning.)

## 6. Adding a provider after this slice

A static-list provider joins the `resolveFromCatalog` group in `resolveProviderModelSelection`; the request and
the settings both follow, with no case in `useSelectedModel`. `docs/10-adding-things.md` is updated.

## 7. Residuals

- The two kept divergences in section 5 (gemini-cli 1M flag, Vertex unset id) are candidates for a visible fix,
  each its own item: in both the request looks right for gemini-cli (it is what runs) and questionable for
  Vertex (a Claude default on the Gemini handler).
- `isUnknownModel` is still computed from the hook's own list lookup; it could read `known` from the resolver
  once the settings-only branches have a list rule of their own.
