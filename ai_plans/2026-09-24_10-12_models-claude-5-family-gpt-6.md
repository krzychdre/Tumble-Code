# New Anthropic and OpenAI models (Claude 5 family, Opus 5.5, Fable 5.1, GPT-6), investigation & fix

**Status:** done on branch `feat/models-opus-5-5-fable-5-1-gpt-6` (bottom of the 2026-09-24 stack)
**Related plans:** `2026-05-26_rebrand-roo-to-tumble-code.md` (naming), Zoo-Code ports #778, #1010, #1508, #1506, #1627
**Touched:**
- `packages/types/src/providers/anthropic.ts`, `bedrock.ts`, `vertex.ts`, `openrouter.ts`, `openai.ts`, `index.ts`
- `src/api/providers/anthropic.ts`, `bedrock.ts`, `openai-native.ts`, `fetchers/openrouter.ts`
- tests: `anthropic.spec.ts`, `bedrock.spec.ts`, `openai-native.spec.ts`, `openai-native-usage.spec.ts`, `fetchers/__tests__/openrouter.spec.ts`, `packages/types/src/__tests__/provider-default-model.spec.ts`

## Sources (checked 2026-09-24)

| Fact | Source |
|---|---|
| Opus 5.5: $4/$20, cache read $0.20, 1M/128K, thinking cannot be disabled, forced `tool_choice` returns 400 | Anthropic model docs (claude-api skill `shared/models.md`, `model-migration.md`), OpenRouter `/api/v1/models` (`anthropic/claude-opus-5.5`, created 2026-09-22) |
| Fable 5.1: $10/$50, cache read $0.25, 1M/128K, same always-on thinking as Fable 5, forced `tool_choice` returns 400 | same, OpenRouter `anthropic/claude-fable-5.1` (2026-09-01) |
| Sonnet 5 is $2/$10 (not $3/$15) | OpenRouter live catalog 2026-09-24, Anthropic model table |
| Bedrock ids `anthropic.claude-opus-5-5`, `anthropic.claude-fable-5-1` | `model-migration.md` platform table |
| GPT-6 Astra $10/$50, Sol $2/$10, Luna $0.10/$0.50; cache write 1.25x, read 0.1x; above 272K input: 2x input and cache, 1.5x output | https://developers.openai.com/api/docs/pricing and the `gpt-6-sol` model page |
| Astra rejects `none` effort (400); Sol and Luna accept it; default effort `medium`; 1.05M context, 128K output | https://developers.openai.com/api/docs/guides/latest-model, `.../guides/reasoning` |
| Responses API reports cache writes in `usage.input_tokens_details.cache_write_tokens` | https://developers.openai.com/api/docs/guides/prompt-caching |
| `gpt-5.6-sol` still lists at $4/$20 | OpenAI pricing page (so Zoo #1506's gpt-5.6 price cut was NOT ported) |

## Symptoms and root causes found while adding the models

1. **Opus 5 (our default model) and Sonnet 5 never used prompt caching on the direct Anthropic provider.**
   `src/api/providers/anthropic.ts` picked the cached request path from two hardcoded `switch (modelId)` lists. Neither list gained `claude-opus-5` or `claude-sonnet-5` when those models were added, so both fell into `default:`, which sends the system prompt and messages with no `cache_control` and no `prompt-caching` beta header. Every turn was billed at the full input price.
2. **Bedrock and Vertex had no Opus 5 / Sonnet 5 entries**, and Bedrock's `isAdaptiveThinkingModel` did not match `opus-5` / `sonnet-5`, so a custom Bedrock id for those models got `budget_tokens` thinking plus `temperature`, both rejected with a 400.
3. **Sonnet 5 price was $3/$15**, 50% too high in cost display.
4. **OpenAI Native sent whatever reasoning effort was saved**, even when the current model rejects it: a `none` saved for GPT-5.6 is a 400 on GPT-6 Astra, and `minimal` is accepted by no GPT-5.1+/GPT-6 model.
5. **OpenAI cache writes were never counted.** `normalizeUsage` looked for `usage.cache_write_tokens` only; the Responses API reports writes inside `input_tokens_details`, so GPT-5.6+/GPT-6 writes were billed at the plain input rate instead of 1.25x (cost under-reported).
6. **A fresh OpenAI Native profile showed `gpt-4o` in the UI** (`getProviderDefaultModelId` returned the literal, which is not even in `openAiNativeModels`), while the handler silently used `gpt-5.6-sol`. (Zoo #1627.)

## Failure surface (before/after)

| Scenario | Before | After |
|---|---|---|
| Anthropic, `claude-opus-5` / `claude-sonnet-5` | no cache breakpoints, full price every turn | system + last two user turns cached, beta header sent |
| Anthropic, new model added to `anthropicModels` later | silently uncached unless someone edits two switches | cached automatically (`info.supportsPromptCache`) |
| Bedrock custom `anthropic.claude-opus-5` | `budget_tokens` + temperature, 400 | adaptive thinking, no temperature |
| OpenAI Native, saved `none`, switch to `gpt-6-astra` | `reasoning.effort: none`, 400 | falls back to `medium` |
| OpenAI Native, saved `disable`, `gpt-6-astra` | reasoning omitted (Astra requires it) | `medium` |
| OpenAI Native, 40K cache writes on `gpt-6-sol` | billed as $2/M input | billed as $2.50/M |
| New OpenAI Native profile, UI | shows `gpt-4o`, no price info | shows `gpt-5.6-sol` like the handler |

## Fix

- Model tables: `claude-opus-5-5`, `claude-fable-5-1` on Anthropic / Bedrock / Vertex / OpenRouter; `claude-opus-5`, `claude-sonnet-5` on Bedrock / Vertex; `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` on OpenAI Native. All Claude 5 entries use the existing Fable 5 convention (`supportsReasoningBinary`, `supportsTemperature: false`). Bedrock and Vertex keep first-party prices, matching the existing entries.
- `AnthropicHandler.createMessage`: `if (info.supportsPromptCache) { cached path } else { plain path }`, the same rule `anthropic-vertex.ts` already used.
- `AwsBedrockHandler.isAdaptiveThinkingModel`: add `opus-5` (matches 5.5) and `sonnet-5`.
- `OpenAiNativeHandler.getReasoningEffort`: validate the saved effort against `supportsReasoningEffort`, fall back to the model default, and ignore `disable` when `requiredReasoningEffort` is set.
- `OpenAiNativeHandler.normalizeUsage`: read `input_tokens_details.cache_write_tokens`.
- `parseOpenRouterModel`: Claude 5 family gets the adaptive-thinking configuration through one id map (dotted OpenRouter ids), GPT-6 Astra gets the required effort list.
- `getProviderDefaultModelId("openai-native")` returns `openAiNativeDefaultModelId`.

## Tests

- `anthropic.spec.ts`: `it.each` over the five Claude 5 ids asserts `cache_control` on system and last user message, adaptive thinking, no temperature, `prompt-caching` header. Failed for opus-5, sonnet-5, opus-5-5, fable-5-1 before the fix.
- `bedrock.spec.ts`: Claude 5 family detection, including a `global.` prefix.
- `openai-native.spec.ts`: seven effort scenarios (4 failed before the fix). Two older tests sent `minimal` to `gpt-5.1`, which our own table says does not accept it; they now use `gpt-5`, whose table does list `minimal`.
- `openai-native-usage.spec.ts`: cache writes from details, priced below the 272K threshold (a first draft used 1M tokens and correctly got the 2x long-context price).
- `provider-default-model.spec.ts`: failed with `gpt-4o` before the fix.
- Ran: `src` vitest for the touched specs, `packages/types` vitest (297), webview `useSelectedModel` + `settings` (370), `tsc --noEmit` in `src` and `packages/types`.

## Deliberately not done

- **Default models unchanged.** Anthropic stays on `claude-opus-5` (Anthropic marks Opus 5.5 "use only when named" during launch), OpenAI stays on `gpt-5.6-sol`. Changing a default changes cost for every new user; that is a product call.
- **Codex (ChatGPT subscription) gets no GPT-6.** Zoo routes Astra through the "Responses Lite" transport introduced for Luna in Zoo #889, which we have not ported and cannot verify without a subscription.
- **`-pro` variants.** For GPT-5.6/GPT-6 "pro" is `reasoning.mode: "pro"` on the same model id, not a separate model; exposing it needs a settings toggle.
- **Forced `tool_choice` normalization for Opus 5.5 / Fable 5.1** (Zoo #1508). Nothing in Tumble sends `required` or a named tool (all task paths send `auto`), so the branch would be dead code.
- **Known pre-existing caveat:** with the reasoning toggle off, Anthropic models get `max_tokens` 8192 while the Claude 5 family still thinks (omitting `thinking` runs adaptive). Same behaviour as Opus 5 / Fable 5 today; worth a separate change that hides the toggle for always-thinking models.
- **Preserved thinking (Fable 5.1 / Opus 5.5).** Accounts created on or after 2026-08-31 get a 400 when an earlier turn containing a thinking block is edited. Our context management (condense, microcompact) edits history; this needs its own investigation.
