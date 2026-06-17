# Port plan — Zoo PR #555 → `feature/zoo-555-add-fable-5-support-across-anthropic-providers`

> **For the executor (read first).** Do the steps in order. Do not improvise or
> refactor beyond what is written (YAGNI). Every code block is already adapted to
> this repo. This repo is **Tumble Code**: never introduce the strings "Roo" or
> "Zoo" in user-facing text. The model id `claude-fable-5` is an **internal model
> id**, not branding — keep it verbatim.

---

## 0. Context

- **Upstream:** Zoo PR #555 — "Add Fable 5 support across Anthropic providers" (commit `cc2654521`).
- **What it does:** Registers the `claude-fable-5` model across every Anthropic-family
  provider path — direct Anthropic, Bedrock, Vertex, OpenRouter, Requesty, and the
  Vercel AI Gateway — including model metadata, the adaptive-thinking guard, and the
  `supportsTemperature: false` plumbing so temperature is omitted for this model.
- **Model facts (mirror upstream, reviewed in PR #555):** context window `1_000_000`;
  direct Anthropic `maxTokens` `128_000` (overridden to 8k when reasoning effort is
  off); Bedrock/Vertex `maxTokens` `8192`; prices in=$10 / out=$50 / cacheWrite=$12.5 /
  cacheRead=$1 per M; `supportsImages`, `supportsPromptCache`, `supportsReasoningBudget`,
  `supportsReasoningBinary` all true; `supportsTemperature: false`. Uses the same
  adaptive-thinking contract as Opus 4.7/4.8.
- **Why we want it:** new top-tier Claude model; our providers have no `claude-fable-5`
  entry yet (verified: `grep claude-fable-5` empty across `packages/types/src/providers/*`
  and `src/api/providers/*`). Low risk, high value — matches our model-support cadence.
- **Adaptations vs. the raw upstream diff (IMPORTANT):**
  1. **Branding:** upstream edits a bedrock comment to say "Zoo Code UI"; our fork already
     reads `// display: "summarized" surfaces thinking content in the UI.`
     ([bedrock.ts:439](../src/api/providers/bedrock.ts#L439)). Keep "the UI" — do NOT
     introduce "Zoo Code". The Fable-5 mentions in the doc comment are optional polish.
  2. **model-params.ts:** upstream adds the `supportsTemperature === false` guard to the
     generic **`else`** branch. Our `format === "anthropic"` branch already has that guard
     ([model-params.ts:151](../src/api/transform/model-params.ts#L151)); the `else` branch
     (our lines 179-187) does NOT. Apply the guard to the `else` branch only.
  3. Dependencies `getAnthropicProviderReasoning` / `AnthropicProviderReasoningParams`
     already exist in [reasoning.ts:61](../src/api/transform/reasoning.ts#L61) — the
     requesty refactor applies cleanly.
- **Original authors — credit them:**

  ```text
  Co-authored-by: T <taltas@users.noreply.github.com>
  Co-authored-by: Elliott de Launay <edelauna@gmail.com>
  ```

## 1. Preconditions

- [ ] Branch `feature/zoo-555-...` created off `main`.
- [ ] No `claude-fable-5` entry exists yet in any provider type/handler.
- [ ] `getAnthropicProviderReasoning` exported from `src/api/transform/reasoning.ts`.

## 2. Source edits

### Edit A — `packages/types/src/providers/anthropic.ts`
Insert a `"claude-fable-5"` entry into `anthropicModels` (before `claude-opus-4-5-20251101`):
maxTokens 128_000, contextWindow 1_000_000, images/cache true, in 10 / out 50 /
cacheWrite 12.5 / cacheRead 1, supportsReasoningBudget/Binary true, supportsTemperature
false, with the upstream description.

### Edit B — `packages/types/src/providers/bedrock.ts`
- Add `"anthropic.claude-fable-5"` to `bedrockModels` (maxTokens 8192, contextWindow 1M,
  cache true + `minTokensPerCachePoint`/`maxCachePoints`/`cachableFields`, same prices,
  reasoning flags, supportsTemperature false, description).
- Append `"anthropic.claude-fable-5"` to `BEDROCK_GLOBAL_INFERENCE_MODEL_IDS` with the
  cross-region comment line.

### Edit C — `packages/types/src/providers/vertex.ts`
Add `"claude-fable-5"` to `vertexModels` (maxTokens 8192, contextWindow 1M, etc.).

### Edit D — `packages/types/src/providers/openrouter.ts`
Add `"anthropic/claude-fable-5"` to both `OPEN_ROUTER_PROMPT_CACHING_MODELS` and
`OPEN_ROUTER_REASONING_BUDGET_MODELS`.

### Edit E — `packages/types/src/providers/vercel-ai-gateway.ts`
Add `"anthropic/claude-fable-5"` to both `VERCEL_AI_GATEWAY_PROMPT_CACHING_MODELS` and
`VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS`.

### Edit F — `src/api/providers/anthropic.ts`
Add `case "claude-fable-5":` to the two switch statements (after `claude-opus-4-8`).

### Edit G — `src/api/providers/bedrock.ts`
Add `baseModelId.includes("fable-5") ||` to the `isAdaptiveThinkingModel` guard. Optional:
mention Fable 5 in the adjacent doc comments — but keep "the UI" wording (no "Zoo Code").

### Edit H — `src/api/providers/requesty.ts`
Swap import to `{ AnthropicProviderReasoningParams, getAnthropicProviderReasoning }`,
change the two `thinking?: AnthropicReasoningParams` to `AnthropicProviderReasoningParams`,
and in `getModel()` compute `reasoning = getAnthropicProviderReasoning({ model: info,
reasoningBudget: params.reasoningBudget, settings: this.options })` and return
`{ id, info, ...params, reasoning }`.

### Edit I — `src/api/providers/vercel-ai-gateway.ts`
Gate temperature on `info.supportsTemperature !== false && this.supportsTemperature(modelId)`
in both `createMessage` and `completePrompt`.

### Edit J — `src/api/providers/fetchers/openrouter.ts`
Add the `anthropic/claude-fable-5` block setting maxTokens + reasoningBinary + temperature.

### Edit K — `src/api/providers/fetchers/requesty.ts`
Add the `anthropic/claude-fable-5` override block (reasoning flags + supportsTemperature false).

### Edit L — `src/api/providers/fetchers/vercel-ai-gateway.ts`
Add the `anthropic/claude-fable-5` → `supportsTemperature = false` block.

### Edit M — `src/api/transform/model-params.ts`
In the **`else`** branch only, prepend `if (model.supportsTemperature === false) {
params.temperature = undefined }` and drop the stale 2-line OpenRouter TODO.

### Edit N — `src/api/providers/anthropic-vertex.ts` (fork-specific; NOT in Zoo's diff)
Zoo's PR did not touch this file because Zoo's Vertex handler already routed
adaptive-binary models through `getAnthropicProviderReasoning` (from an earlier PR).
**Our fork never got that change** — our `getModel()` returned `params.reasoning`
from `getModelParams` (`getAnthropicReasoning`), which always emits
`{ type: "enabled", budget_tokens }`. So Fable 5 (and Opus 4.7/4.8) on Vertex sent
the wrong thinking config. Root cause proven via the new vertex adaptive test failing
with `{ type: "enabled", budget_tokens: 8192 }` instead of `{ type: "adaptive" }`.
Fix: import `getAnthropicProviderReasoning`; in `getModel()` compute
`thinking = getAnthropicProviderReasoning({ model: info, reasoningBudget:
params.reasoningBudget, reasoningEffort: params.reasoningEffort, settings: this.options })`
and return `{ ...params, reasoning: thinking }`. Because `{ type: "adaptive" }` is not in
the SDK's `ThinkingConfigParam` union, change the `createMessage`/`completePrompt` `params`
declarations from a `: Anthropic.Messages.MessageCreateParams…` annotation to an
`as Anthropic.Messages.MessageCreateParams…` cast (mirrors `AnthropicHandler`).

## 3. Tests (port from upstream, adapt anchors)

Add the Fable-5 cases to: `anthropic.spec.ts`, `anthropic-vertex.spec.ts`, `bedrock.spec.ts`,
`requesty.spec.ts`, `vercel-ai-gateway.spec.ts`, `fetchers/__tests__/openrouter.spec.ts`,
`fetchers/__tests__/vercel-ai-gateway.spec.ts`, `transform/__tests__/model-params.spec.ts`,
`shared/__tests__/api.spec.ts`, and create new `fetchers/__tests__/requesty.spec.ts`.

## 4. Out of scope
- No "Zoo Code" branding. No TTS/router/cloud. Internal id `claude-fable-5` stays.

## 5. Verify
- `pnpm --filter @roo-code/types check-types` clean.
- `cd src && npx vitest run api/providers/__tests__/anthropic.spec.ts api/providers/__tests__/bedrock.spec.ts api/providers/__tests__/anthropic-vertex.spec.ts api/providers/__tests__/requesty.spec.ts api/providers/__tests__/vercel-ai-gateway.spec.ts api/providers/fetchers/__tests__/openrouter.spec.ts api/providers/fetchers/__tests__/requesty.spec.ts api/providers/fetchers/__tests__/vercel-ai-gateway.spec.ts api/transform/__tests__/model-params.spec.ts shared/__tests__/api.spec.ts` all green.

## 6. Acceptance
- [ ] All new Fable-5 tests pass; touched suites green.
- [ ] No "Roo"/"Zoo" user-facing strings introduced.

## 7. Record
```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record --pr 555 --status ported \
  --branch feature/zoo-555-add-fable-5-support-across-anthropic-providers \
  --plan ai_plans/2026-06-17_zoo-555-add-fable-5-support-across-anthropic-providers.md
```
