# Port plan — Zoo PR #6 → `feature/zoo-6-deepseek-v4`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text. Placeholders are written as `{{like this}}` — replace every one.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #6 — "DeepSeek V4 Support" (merge commit `de23b1f1b`;
  feature tip `221dfc90d`, base/merge-base `96d6e4364`).
- **What it does, one paragraph:** Adds DeepSeek's V4 model family
  (`deepseek-v4-flash`, `deepseek-v4-pro`) with a 1M-token context window and a
  thinking/non-thinking toggle driven by a `reasoning_effort` parameter
  (`high`/`max`). It makes `deepseek-v4-flash` the new default model, demotes the
  old `deepseek-chat`/`deepseek-reasoner` ids to legacy compatibility aliases,
  and rewires the `DeepSeekHandler` so thinking mode + reasoning effort are
  computed per-model instead of the old "is the id `deepseek-reasoner`?" string
  check. It also caps the request's `max_completion_tokens` to the _computed_
  max (the project's 20%-of-context convention) rather than V4's raw 384K
  advertised max.
- **Why we want it, with evidence in OUR code:** Our fork is stuck on the V3.2
  generation. [packages/types/src/providers/deepseek.ts:9](packages/types/src/providers/deepseek.ts#L9)
  defaults to `deepseek-chat` and the model map has only `deepseek-chat` /
  `deepseek-reasoner`. The handler at
  [src/api/providers/deepseek.ts:59](src/api/providers/deepseek.ts#L59) decides
  thinking mode with `modelId.includes("deepseek-reasoner")` and never sends
  `reasoning_effort`, so the V4 models cannot be selected and — if selected by id
  — would run in the wrong mode and over-request output tokens (384K) via
  [src/api/providers/deepseek.ts:85](src/api/providers/deepseek.ts#L85)
  (`addMaxTokensIfNeeded` uses raw `modelInfo.maxTokens`). The dynamic-provider
  plumbing (fetcher, modelCache case, webview wiring, `useSelectedModel` case,
  `dynamicProviders`/`dynamicProviderExtras`, validate.spec) is **already present
  in our fork** (ported earlier via PR #15) — this port only adds the V4 model
  data and the V4-aware request logic on top of that.
- **What we deliberately leave out (YAGNI):**
    - The upstream removal of the `simplifySettings` prop from `DeepSeek.tsx` /
      `ApiOptions.tsx`. That is a Zoo-only UI divergence: **our** fork uses
      `simplifySettings` across **every** provider component
      ([webview-ui/src/components/settings/ApiOptions.tsx](webview-ui/src/components/settings/ApiOptions.tsx)
      passes it to ~17 providers). Removing it from DeepSeek alone would break our
      convention. Do **not** touch those files.
    - All the Roo cloud / credit-balance / task-share / `requestRooModels` churn
      that appears in a raw merge-parent diff — that is **merge noise from Zoo's
      base branch**, not part of this PR. The true PR (merge-base→tip) only adds the
      `deepseek` case to `webviewMessageHandler` model wiring, which we **already
      have** ([src/core/webview/webviewMessageHandler.ts:1069](src/core/webview/webviewMessageHandler.ts#L1069)).
      Do **not** re-add any router / cloud / credit code.
    - The `src/api/providers/fetchers/deepseek.ts` file — **already identical** in
      our fork. Do not recreate it.
- **Original author(s) — credit them.** Derek Robertson (doctarock). When you
  create the port commit (only if asked), include this trailer at the end of the
  commit message:

    ```text
    Co-authored-by: Derek Robertson <mail@derek.net.au>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-6-deepseek-v4`, created off `main`.
- [ ] These files exist (the edits below depend on them):
    - `packages/types/src/providers/deepseek.ts`
    - `src/api/providers/deepseek.ts`
    - `src/api/providers/__tests__/deepseek.spec.ts`
- [ ] Already present (do **not** re-add): `src/api/providers/fetchers/deepseek.ts`,
      the `deepseek` case in `src/api/providers/fetchers/modelCache.ts`,
      `deepseek` in `dynamicProviders`
      ([packages/types/src/provider-settings.ts:44](packages/types/src/provider-settings.ts#L44))
      and `dynamicProviderExtras`
      ([src/shared/api.ts:180](src/shared/api.ts#L180)), the `deepseek` case in
      `useSelectedModel.ts`, and the `deepseek: {}` entry in `validate.spec.ts`.
- [ ] The code we will change still looks like this (if it differs, STOP — the
      plan is stale):

`packages/types/src/providers/deepseek.ts` (lines 9–11):

```ts
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"

export const deepSeekModels = {
	"deepseek-chat": {
```

`src/api/providers/deepseek.ts` (lines 20–23):

```ts
// Custom interface for DeepSeek params to support thinking mode
type DeepSeekChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking?: { type: "enabled" | "disabled" }
}
```

`src/api/providers/deepseek.ts` (lines 55–85, the createMessage head + request build):

```ts
const modelId = this.options.apiModelId ?? deepSeekDefaultModelId
const { info: modelInfo } = this.getModel()

// Check if this is a thinking-enabled model (deepseek-reasoner)
const isThinkingModel = modelId.includes("deepseek-reasoner")
```

## 2. Write the failing test FIRST (TDD)

- **File:** `src/api/providers/__tests__/deepseek.spec.ts` (exists).
- This suite's `openai` mock currently keys reasoning emission off the **model
  id** (`options.model?.includes("deepseek-reasoner")`). The new V4 tests assert
  on `thinking`/`reasoning_effort` being sent, and the V4 models emit thinking
  via the `thinking` param, not the id — so first switch the mock to key off
  `thinking`, then add the new cases.

### Test edit 2a — fix the mock trigger

Replace (around lines 32–40):

```ts
						// Check if this is a reasoning_content test by looking at model
						const isReasonerModel = options.model?.includes("deepseek-reasoner")
						const isToolCallTest = options.tools?.length > 0

						// Return async iterator for streaming
						return {
							[Symbol.asyncIterator]: async function* () {
								// For reasoner models, emit reasoning_content first
								if (isReasonerModel) {
```

With:

```ts
						// Check if this is a reasoning_content test by looking at thinking mode
						const isThinkingModel = options.thinking?.type === "enabled"
						const isToolCallTest = options.tools?.length > 0

						// Return async iterator for streaming
						return {
							[Symbol.asyncIterator]: async function* () {
								// For thinking models, emit reasoning_content first
								if (isThinkingModel) {
```

And replace (the tool-call branch, around lines 61–62):

```ts
									// For tool call tests with reasoner, emit tool call
									if (isReasonerModel && isToolCallTest) {
```

With:

```ts
									// For tool call tests with thinking mode, emit tool call
									if (isThinkingModel && isToolCallTest) {
```

### Test edit 2b — add V4 model-info + request cases

In the `describe("getModel", ...)` block, **after** the existing
`it("should return model info for valid model ID", ...)` test (the one ending at
the line `expect(model.info.supportsPromptCache).toBe(true) // Should be true now`),
add these two new tests:

```ts
it("should use deepseek-v4-flash as the default model ID for new configs", () => {
	const handlerWithoutModel = new DeepSeekHandler({
		...mockOptions,
		apiModelId: undefined,
	})
	const model = handlerWithoutModel.getModel()
	expect(model.id).toBe(deepSeekDefaultModelId)
	expect(model.id).toBe("deepseek-v4-flash")
	expect(model.info.maxTokens).toBe(384_000)
	expect(model.info.contextWindow).toBe(1_000_000)
	expect((model.info as ModelInfo).supportsReasoningEffort).toContain("xhigh")
})

it("should return correct model info for deepseek-v4-pro", () => {
	const handlerWithV4Pro = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "deepseek-v4-pro",
	})
	const model = handlerWithV4Pro.getModel()
	expect(model.id).toBe("deepseek-v4-pro")
	expect(model.info).toBeDefined()
	expect(model.info.maxTokens).toBe(384_000)
	expect(model.info.contextWindow).toBe(1_000_000)
	expect(model.info.supportsPromptCache).toBe(true)
	expect((model.info as ModelInfo).preserveReasoning).toBe(true)
	expect((model.info as ModelInfo).reasoningEffort).toBe("high")
})
```

Then, inside `describe("interleaved thinking mode", ...)`, **after** the
`it("should NOT pass thinking parameter for deepseek-chat model", ...)` test,
add these V4 request-shape tests:

```ts
it("should enable thinking by default for deepseek-v4-flash", async () => {
	const v4Handler = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "deepseek-v4-flash",
	})

	const stream = v4Handler.createMessage(systemPrompt, messages)
	for await (const _chunk of stream) {
		// Consume the stream
	}

	expect(mockCreate).toHaveBeenCalledWith(
		expect.objectContaining({
			thinking: { type: "enabled" },
			reasoning_effort: "high",
			max_completion_tokens: 200_000,
		}),
		{},
	)
})

it("should respect user max token override for deepseek-v4 models", async () => {
	const v4Handler = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "deepseek-v4-flash",
		modelMaxTokens: 32_000,
	})

	const stream = v4Handler.createMessage(systemPrompt, messages)
	for await (const _chunk of stream) {
		// Consume the stream
	}

	const callArgs = mockCreate.mock.calls[0][0]
	expect(callArgs.max_completion_tokens).toBe(32_000)
})

it("should map xhigh reasoning effort to DeepSeek max effort", async () => {
	const v4Handler = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "deepseek-v4-pro",
		reasoningEffort: "xhigh",
	})

	const stream = v4Handler.createMessage(systemPrompt, messages)
	for await (const _chunk of stream) {
		// Consume the stream
	}

	expect(mockCreate).toHaveBeenCalledWith(
		expect.objectContaining({
			thinking: { type: "enabled" },
			reasoning_effort: "max",
		}),
		{},
	)
})

it("should disable thinking for deepseek-v4 models when reasoning is disabled", async () => {
	const v4Handler = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "deepseek-v4-pro",
		enableReasoningEffort: false,
	})

	const stream = v4Handler.createMessage(systemPrompt, messages)
	for await (const _chunk of stream) {
		// Consume the stream
	}

	const callArgs = mockCreate.mock.calls[0][0]
	expect(callArgs.thinking).toEqual({ type: "disabled" })
	expect(callArgs.reasoning_effort).toBeUndefined()
})

it("should not send V4 thinking parameters for unknown model IDs", async () => {
	const customHandler = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "custom-deepseek-model",
	})

	const stream = customHandler.createMessage(systemPrompt, messages)
	for await (const _chunk of stream) {
		// Consume the stream
	}

	const callArgs = mockCreate.mock.calls[0][0]
	expect(callArgs.thinking).toBeUndefined()
	expect(callArgs.reasoning_effort).toBeUndefined()
	expect(callArgs.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
})
```

> Note: the existing `it("should return model info for valid model ID", ...)`
> test creates `handler` with `apiModelId: "deepseek-chat"` (from `mockOptions`),
> so its `maxTokens === 8192` assertion stays valid because `deepseek-chat`
> remains an 8K legacy alias. Do not change that test.

### Test edit 2c — fix a pre-existing test the default change breaks

Changing the default from `deepseek-chat` to `deepseek-v4-flash` means the
"invalid model" fallback now resolves to v4-flash info, which is **no longer**
the same object as `handler` (which uses `deepseek-chat`). The upstream PR fixes
this by comparing against a fresh default handler. In
`it("should return provided model ID with default model info if model does not exist", ...)`,
add a `defaultHandler` and compare against it:

```ts
it("should return provided model ID with default model info if model does not exist", () => {
	const handlerWithInvalidModel = new DeepSeekHandler({
		...mockOptions,
		apiModelId: "invalid-model",
	})
	const defaultHandler = new DeepSeekHandler({
		...mockOptions,
		apiModelId: undefined,
	})
	const model = handlerWithInvalidModel.getModel()
	expect(model.id).toBe("invalid-model") // Returns provided ID
	expect(model.info).toBeDefined()
	// With the current implementation, it's the same object reference when using default model info
	expect(model.info).toBe(defaultHandler.getModel().info)
	// Should have the same base properties
	expect(model.info.contextWindow).toBe(defaultHandler.getModel().info.contextWindow)
	// And should have supportsPromptCache set to true
	expect(model.info.supportsPromptCache).toBe(true)
})
```

- **Run:** `cd src && npx vitest run api/providers/__tests__/deepseek.spec.ts`
- **Expect it to FAIL** — the new cases reference `deepseek-v4-flash` /
  `deepseek-v4-pro` which don't exist yet (default id is still `deepseek-chat`,
  so `deepSeekDefaultModelId !== "deepseek-v4-flash"`), and the handler never
  sends `reasoning_effort`.
- If it **passes already**, STOP and report.

## 3. Implement — minimal change to make the test pass

### Edit 1 — `packages/types/src/providers/deepseek.ts`

Replace:

```ts
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"

export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `DeepSeek-V3.2 (Non-thinking Mode) achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally. Supports JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta).`,
	},
	"deepseek-reasoner": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		preserveReasoning: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `DeepSeek-V3.2 (Thinking Mode) achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks. Supports Chain of Thought reasoning with up to 8K output tokens. Supports JSON output, tool calls, and chat prefix completion (beta).`,
	},
} as const satisfies Record<string, ModelInfo>
```

With:

```ts
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-v4-flash"

export const deepSeekModels = {
	"deepseek-v4-flash": {
		maxTokens: 384_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: ["disable", "low", "medium", "high", "xhigh"],
		preserveReasoning: true,
		reasoningEffort: "high",
		inputPrice: 0.14, // $0.14 per million tokens (cache miss) - Updated Apr 29, 2026
		outputPrice: 0.28, // $0.28 per million tokens - Updated Apr 29, 2026
		cacheWritesPrice: 0.14, // $0.14 per million tokens (cache miss) - Updated Apr 29, 2026
		cacheReadsPrice: 0.0028, // $0.0028 per million tokens (cache hit) - Updated Apr 29, 2026
		description: `DeepSeek-V4-Flash is DeepSeek's fast, cost-efficient V4 model. It supports thinking and non-thinking modes, JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta) in non-thinking mode.`,
	},
	"deepseek-v4-pro": {
		maxTokens: 384_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: ["disable", "low", "medium", "high", "xhigh"],
		preserveReasoning: true,
		reasoningEffort: "high",
		// TODO(deepseek): Re-check V4 Pro discounted prices after DeepSeek's 2026-05-31 discount end date.
		inputPrice: 0.435, // $0.435 per million tokens (cache miss, discounted) - Updated Apr 29, 2026
		outputPrice: 0.87, // $0.87 per million tokens (discounted) - Updated Apr 29, 2026
		cacheWritesPrice: 0.435, // $0.435 per million tokens (cache miss, discounted) - Updated Apr 29, 2026
		cacheReadsPrice: 0.003625, // $0.003625 per million tokens (cache hit, discounted) - Updated Apr 29, 2026
		description: `DeepSeek-V4-Pro is DeepSeek's strongest V4 model for reasoning, coding, long-context, and agentic workloads. It supports thinking and non-thinking modes, JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta) in non-thinking mode.`,
	},
	// TODO(deepseek): Remove this compatibility alias after DeepSeek's 2026-07-24 retirement date.
	"deepseek-chat": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `Legacy compatibility alias for the non-thinking mode of deepseek-v4-flash. DeepSeek plans to deprecate this model name on 2026-07-24.`,
	},
	// TODO(deepseek): Remove this compatibility alias after DeepSeek's 2026-07-24 retirement date.
	"deepseek-reasoner": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		preserveReasoning: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `Legacy compatibility alias for the thinking mode of deepseek-v4-flash. DeepSeek plans to deprecate this model name on 2026-07-24.`,
	},
} as const satisfies Record<string, ModelInfo>
```

### Edit 2 — `src/api/providers/deepseek.ts` (imports + param type + helpers)

Replace:

```ts
import {
	deepSeekModels,
	deepSeekDefaultModelId,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"
```

With:

```ts
import {
	deepSeekModels,
	deepSeekDefaultModelId,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"
```

> (No change to the import block — `ModelInfo` is **not** needed in our handler
> because, unlike upstream, we do not add a type-only annotation here. Leave the
> imports exactly as-is. This sub-step is intentionally a no-op; do not edit.)

Then replace the param-type + add helpers. Replace:

```ts
// Custom interface for DeepSeek params to support thinking mode
type DeepSeekChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking?: { type: "enabled" | "disabled" }
}
```

With:

```ts
// Custom interface for DeepSeek params to support thinking mode
type DeepSeekChatCompletionParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "reasoning_effort"> & {
	thinking?: { type: "enabled" | "disabled" }
	reasoning_effort?: "high" | "max"
}

const deepSeekV4ThinkingModels = new Set(["deepseek-v4-flash", "deepseek-v4-pro"])
const supportsDeepSeekThinkingToggle = (modelId: string) => deepSeekV4ThinkingModels.has(modelId)

// Only known V4 models and the legacy reasoner alias support DeepSeek's
// thinking fields. Custom model IDs still fall back to default metadata, but
// should not receive V4-only request parameters.
const isDeepSeekThinkingEnabled = (modelId: string, options: ApiHandlerOptions) => {
	if (options.enableReasoningEffort === false || options.reasoningEffort === "disable") {
		return false
	}

	return modelId === "deepseek-reasoner" || supportsDeepSeekThinkingToggle(modelId)
}

const normalizeDeepSeekReasoningEffort = (reasoningEffort?: string): "high" | "max" | undefined => {
	if (!reasoningEffort || reasoningEffort === "disable") {
		return undefined
	}

	// DeepSeek currently maps low/medium to high and xhigh to max in thinking mode.
	return reasoningEffort === "xhigh" ? "max" : "high"
}

// Use the computed maxTokens from getModelParams rather than raw model metadata.
// V4 advertises a 384K maximum output, but the project convention caps most
// models to 20% of context unless the user explicitly overrides modelMaxTokens.
const addDeepSeekMaxTokensIfNeeded = (
	requestOptions: DeepSeekChatCompletionParams,
	options: ApiHandlerOptions,
	computedMaxTokens?: number,
) => {
	if (options.includeMaxTokens === true) {
		requestOptions.max_completion_tokens = options.modelMaxTokens || computedMaxTokens
	}
}
```

### Edit 3 — `src/api/providers/deepseek.ts` (createMessage thinking/effort logic)

Replace:

```ts
const modelId = this.options.apiModelId ?? deepSeekDefaultModelId
const { info: modelInfo } = this.getModel()

// Check if this is a thinking-enabled model (deepseek-reasoner)
const isThinkingModel = modelId.includes("deepseek-reasoner")

// Convert messages to R1 format (merges consecutive same-role messages)
// This is required for DeepSeek which does not support successive messages with the same role
// For thinking models (deepseek-reasoner), enable mergeToolResultText to preserve reasoning_content
// during tool call sequences. Without this, environment_details text after tool_results would
// create user messages that cause DeepSeek to drop all previous reasoning_content.
// See: https://api-docs.deepseek.com/guides/thinking_mode
const convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages], {
	mergeToolResultText: isThinkingModel,
})

const requestOptions: DeepSeekChatCompletionParams = {
	model: modelId,
	temperature: this.options.modelTemperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
	messages: convertedMessages,
	stream: true as const,
	stream_options: { include_usage: true },
	// Enable thinking mode for deepseek-reasoner or when tools are used with thinking model
	...(isThinkingModel && { thinking: { type: "enabled" } }),
	tools: this.convertToolsForOpenAI(metadata?.tools),
	tool_choice: metadata?.tool_choice,
	parallel_tool_calls: metadata?.parallelToolCalls ?? true,
}

// Add max_tokens if needed
this.addMaxTokensIfNeeded(requestOptions, modelInfo)
```

With:

```ts
const modelId = this.options.apiModelId ?? deepSeekDefaultModelId
const { info: modelInfo, temperature, reasoningEffort, maxTokens } = this.getModel()

const isThinkingModel = isDeepSeekThinkingEnabled(modelId, this.options)
const thinking = supportsDeepSeekThinkingToggle(modelId)
	? ({ type: isThinkingModel ? "enabled" : "disabled" } as const)
	: isThinkingModel
		? ({ type: "enabled" } as const)
		: undefined
const deepSeekReasoningEffort = isThinkingModel ? normalizeDeepSeekReasoningEffort(reasoningEffort) : undefined

// Convert messages to R1 format (merges consecutive same-role messages)
// This is required for DeepSeek which does not support successive messages with the same role
// For thinking models, enable mergeToolResultText to preserve reasoning_content
// during tool call sequences. Without this, environment_details text after tool_results would
// create user messages that cause DeepSeek to drop all previous reasoning_content.
// See: https://api-docs.deepseek.com/guides/thinking_mode
const convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages], {
	mergeToolResultText: isThinkingModel,
})

const requestOptions: DeepSeekChatCompletionParams = {
	model: modelId,
	...(!isThinkingModel && { temperature: temperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE }),
	messages: convertedMessages,
	stream: true as const,
	stream_options: { include_usage: true },
	...(thinking && { thinking }),
	...(deepSeekReasoningEffort && { reasoning_effort: deepSeekReasoningEffort }),
	tools: this.convertToolsForOpenAI(metadata?.tools),
	tool_choice: metadata?.tool_choice,
	parallel_tool_calls: metadata?.parallelToolCalls ?? true,
}

addDeepSeekMaxTokensIfNeeded(requestOptions, this.options, maxTokens)
```

### Edit 4 — `src/api/providers/deepseek.ts` (cast at the create call)

Our handler creates the stream via `this.getClient()` (a lazy getter) and wraps
errors with `handleOpenAIError` — **keep both**. Only add the type cast that the
new `DeepSeekChatCompletionParams` (which omits/narrows `reasoning_effort`)
requires. Replace:

```ts
let stream
try {
	stream = await this.getClient().chat.completions.create(
		requestOptions,
		isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
	)
} catch (error) {
	const { handleOpenAIError } = await import("./utils/openai-error-handler")
	throw handleOpenAIError(error, "DeepSeek")
}
```

With:

```ts
let stream
try {
	stream = await this.getClient().chat.completions.create(
		requestOptions as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
		isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
	)
} catch (error) {
	const { handleOpenAIError } = await import("./utils/openai-error-handler")
	throw handleOpenAIError(error, "DeepSeek")
}
```

## 4. Out of scope — do NOT do these

- Do **not** remove the `simplifySettings` prop from `DeepSeek.tsx` or
  `ApiOptions.tsx` (Zoo divergence; our fork relies on it everywhere).
- Do **not** recreate `src/api/providers/fetchers/deepseek.ts` or re-add the
  `deepseek` cases in `modelCache.ts` / `webviewMessageHandler.ts` /
  `useSelectedModel.ts` / `provider-settings.ts` / `shared/api.ts` /
  `validate.spec.ts` — all already present.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, Roo credit-balance / task-share handlers, or **Roo/Zoo branding**.
- Do **not** rename internal ids (those stay `Roo-Code`); only user-facing strings
  are "Tumble".

## 5. Verify — paste real output, don't claim success without it

- `cd src && npx vitest run api/providers/__tests__/deepseek.spec.ts` → all
  tests pass (new V4 cases + the unchanged legacy-alias cases).
- `cd packages/types && npx vitest run` (or the package's typecheck) — the
  `deepSeekModels` map must still satisfy `Record<string, ModelInfo>`.
- `pnpm --filter @roo-code/types check-types` and
  `cd src && npx tsc --noEmit` (or the repo's typecheck script) → clean; the
  `DeepSeekChatCompletionParams` cast must not introduce a type error.

## 6. Acceptance criteria (binary — all must hold)

- [ ] The §2 tests pass; the surrounding `deepseek.spec.ts` suite is green.
- [ ] Only `packages/types/src/providers/deepseek.ts`,
      `src/api/providers/deepseek.ts`, and
      `src/api/providers/__tests__/deepseek.spec.ts` changed (`git status`).
- [ ] `deepseek-v4-flash` is the default; `deepseek-chat` / `deepseek-reasoner`
      remain selectable as legacy aliases (8K).
- [ ] No new "Roo" or "Zoo" user-facing strings introduced.
- [ ] No removed feature (TTS / router / cloud / credits) was reintroduced.

## 7. Record in the ledger (after acceptance)

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 6 --status ported \
  --branch feature/zoo-6-deepseek-v4 \
  --plan ai_plans/2026-05-31_zoo-6-deepseek-v4.md
```

When you commit (only if asked), append the `Co-authored-by:` trailer from §0 to
the commit message. Then summarize what landed and let the user review.
