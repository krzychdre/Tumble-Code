// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/anthropic.spec.ts
// Stream mapping and cost: transform/__tests__/anthropic-stream.spec and the protocol
// characterization. This spec covers what AnthropicHandler adds: auth, model selection and
// the request it builds.

const mocks = vi.hoisted(() => ({ create: vi.fn(), captureException: vi.fn() }))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: mocks.captureException } },
}))
vi.mock("@anthropic-ai/sdk", async () => {
	const { anthropicModuleMock } = await import("./provider-test-helpers")
	return anthropicModuleMock(mocks.create)
})

import { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { anthropicDefaultModelId, anthropicModels } from "@tumble-code/types"

import { AnthropicHandler } from "../anthropic"
import { defaultAnthropicCreate } from "./provider-test-helpers"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new AnthropicHandler({ apiKey: "test-api-key", apiModelId: "claude-sonnet-4-5", ...options })
}

async function requestOf(
	handler: AnthropicHandler,
	messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }],
	metadata?: Parameters<AnthropicHandler["createMessage"]>[2],
) {
	for await (const _chunk of handler.createMessage("System", messages, metadata)) {
		// drain
	}
	const [body, requestOptions] = mocks.create.mock.calls.at(-1)!
	return { body, betas: (requestOptions?.headers?.["anthropic-beta"] ?? "").split(","), requestOptions }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultAnthropicCreate)
})

describe("client auth", () => {
	it.each([
		["the API key by default", {}, { apiKey: "test-api-key" }, "authToken"],
		[
			"the API key when the auth token is asked for without a base URL",
			{ anthropicUseAuthToken: true },
			{ apiKey: "test-api-key" },
			"authToken",
		],
		[
			"an auth token for a custom base URL",
			{ anthropicBaseUrl: "https://proxy.example.com", anthropicUseAuthToken: true },
			{ authToken: "test-api-key", baseURL: "https://proxy.example.com" },
			"apiKey",
		],
	])("sends %s", (_label, options, expected, absent) => {
		handlerFor(options)
		const config = vi.mocked(Anthropic).mock.calls.at(-1)![0]!
		expect(config).toMatchObject(expected)
		expect((config as Record<string, unknown>)[absent]).toBeUndefined()
	})
})

describe("getModel", () => {
	it.each([
		["the default model without an id", undefined, anthropicDefaultModelId, anthropicDefaultModelId],
		["a known id", "claude-sonnet-4-5", "claude-sonnet-4-5", "claude-sonnet-4-5"],
		[
			"a custom id that contains a known id",
			"Anthropic/Claude-Sonnet-4-5-20250929",
			"Anthropic/Claude-Sonnet-4-5-20250929",
			"claude-sonnet-4-5",
		],
		["an undated alias of a dated model", "claude-haiku-4-5", "claude-haiku-4-5", "claude-haiku-4-5-20251001"],
		["the longest known id of several", "claude-opus-5-5-20261001", "claude-opus-5-5-20261001", "claude-opus-5-5"],
	])("resolves %s", (_label, apiModelId, id, infoOf) => {
		const model = handlerFor({ apiModelId }).getModel()
		expect(model.id).toBe(id)
		expect(model.info).toEqual(anthropicModels[infoOf as keyof typeof anthropicModels])
	})

	it.each([
		["a model retired on the Claude API", "claude-sonnet-4-20250514"],
		["an unrecognized proxy id", "my-proxy-model"],
		["an inherited object key", "toString"],
	])("keeps %s with the default model's limits and no prices", (_label, apiModelId) => {
		const { id, info } = handlerFor({ apiModelId }).getModel()
		const defaultInfo = anthropicModels[anthropicDefaultModelId]
		expect(id).toBe(apiModelId)
		expect(info).toMatchObject({
			contextWindow: defaultInfo.contextWindow,
			maxTokens: defaultInfo.maxTokens,
			supportsPromptCache: true,
		})
		expect([info.inputPrice, info.outputPrice, info.cacheWritesPrice, info.cacheReadsPrice]).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		])
	})

	it("honors custom max tokens and thinking budget only with the reasoning budget on", () => {
		const custom = { modelMaxTokens: 32_768, modelMaxThinkingTokens: 16_384 }
		expect(handlerFor({ ...custom, enableReasoningEffort: true }).getModel()).toMatchObject({
			maxTokens: 32_768,
			reasoningBudget: 16_384,
		})
		const off = handlerFor(custom).getModel()
		expect(off.maxTokens).toBe(8192)
		expect(off.reasoningBudget).toBeUndefined()
	})

	it.each([
		["claude-sonnet-4-5", true, { contextWindow: 1_000_000, inputPrice: 6.0, outputPrice: 22.5 }],
		["claude-sonnet-4-6", true, { contextWindow: 1_000_000, inputPrice: 3.0, outputPrice: 15.0 }],
		["claude-sonnet-4-5", false, { contextWindow: 200_000, inputPrice: 3.0 }],
	])("prices %s with the 1M flag %s", (apiModelId, anthropicBeta1MContext, expected) => {
		expect(handlerFor({ apiModelId, anthropicBeta1MContext }).getModel().info).toMatchObject(expected)
	})
})

describe("createMessage request", () => {
	it("marks the system prompt and the user messages for caching and passes the task signal", async () => {
		const signal = new AbortController().signal
		const { body, betas, requestOptions } = await requestOf(handlerFor(), undefined, { taskId: "t", signal })

		expect(body).toMatchObject({
			model: "claude-sonnet-4-5",
			max_tokens: 8192,
			stream: true,
			system: [{ text: "System", type: "text", cache_control: { type: "ephemeral" } }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] },
			],
		})
		expect(betas).toEqual(["fine-grained-tool-streaming-2025-05-14", "prompt-caching-2024-07-31"])
		expect(requestOptions.signal).toBe(signal)
	})

	it.each([
		["claude-sonnet-4-5", true, true],
		["claude-sonnet-4-5", false, false],
		["claude-opus-4-7", true, false],
		["claude-opus-4-8", true, false],
	])("%s with the 1M flag %s sends the 1M beta: %s", async (apiModelId, anthropicBeta1MContext, sendsBeta) => {
		const { betas } = await requestOf(handlerFor({ apiModelId, anthropicBeta1MContext }))
		expect(betas.includes("context-1m-2025-08-07")).toBe(sendsBeta)
	})

	// Opus 5 and Sonnet 5 were missing from a hardcoded caching switch once, so their
	// requests went out without cache breakpoints.
	it.each([
		"claude-opus-5-5",
		"claude-opus-5",
		"claude-sonnet-5-5",
		"claude-sonnet-5",
		"claude-fable-5-1",
		"claude-fable-5",
		"claude-haiku-5-5",
		"claude-opus-4-7",
	])("sends cache breakpoints and adaptive thinking without temperature for %s", async (apiModelId) => {
		const { body, betas } = await requestOf(handlerFor({ apiModelId, enableReasoningEffort: true }))
		expect(body.system[0].cache_control).toEqual({ type: "ephemeral" })
		expect(body.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" })
		expect(body.thinking).toEqual({ type: "adaptive" })
		expect(body).not.toHaveProperty("temperature")
		expect(betas).toContain("prompt-caching-2024-07-31")
	})

	// Sonnet 5.5 and Haiku 5.5 reject `thinking: {type: "disabled"}` and budget_tokens: with the
	// toggle off the parameter is omitted, which the API runs as adaptive thinking.
	it.each(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-4-7"])(
		"omits thinking for %s when reasoning is off",
		async (apiModelId) => {
			const { body } = await requestOf(handlerFor({ apiModelId, enableReasoningEffort: false }))
			expect(body.thinking).toBeUndefined()
		},
	)

	it("keeps the custom max tokens with adaptive thinking", async () => {
		const { body } = await requestOf(
			handlerFor({ apiModelId: "claude-opus-4-7", enableReasoningEffort: true, modelMaxTokens: 32768 }),
		)
		expect(body.max_tokens).toBe(32768)
	})

	describe("output_config.effort", () => {
		it.each([
			[
				"next to the toggle off (Opus 5.5 cannot disable thinking)",
				{ apiModelId: "claude-opus-5-5", enableReasoningEffort: false, reasoningEffort: "xhigh" },
				undefined,
				{ effort: "xhigh" },
			],
			[
				"next to adaptive thinking",
				{ apiModelId: "claude-opus-4-7", enableReasoningEffort: true, reasoningEffort: "low" },
				{ type: "adaptive" },
				{ effort: "low" },
			],
			[
				"next to budget thinking (Opus 4.6)",
				{
					apiModelId: "claude-opus-4-6",
					enableReasoningEffort: true,
					reasoningEffort: "max",
					modelMaxThinkingTokens: 4096,
				},
				{ type: "enabled", budget_tokens: 4096 },
				{ effort: "max" },
			],
		])("is sent %s", async (_label, options, thinking, outputConfig) => {
			const { body } = await requestOf(handlerFor(options as Partial<ApiHandlerOptions>))
			expect(body.thinking).toEqual(thinking)
			expect(body.output_config).toEqual(outputConfig)
		})

		it.each([
			["claude-opus-5-5", undefined],
			["claude-opus-5-5", "minimal"],
			["claude-opus-5-5", "none"],
			["claude-opus-4-6", "xhigh"],
			["claude-opus-4-5-20251101", "max"],
			["claude-sonnet-4-5", "high"],
			["claude-haiku-4-5-20251001", "high"],
		] as const)("is omitted for %s with level %s (unset or not offered)", async (apiModelId, reasoningEffort) => {
			const { body } = await requestOf(handlerFor({ apiModelId, enableReasoningEffort: true, reasoningEffort }))
			expect(body).not.toHaveProperty("output_config")
		})
	})

	it("converts the tools, tool_choice and parallel tool calls", async () => {
		const tools: OpenAI.Chat.ChatCompletionTool[] = [
			{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } },
		]
		const { body } = await requestOf(handlerFor(), undefined, {
			taskId: "t",
			tools,
			tool_choice: "required",
			parallelToolCalls: false,
		})
		expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(["get_weather"])
		expect(body.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true })
	})

	it("leaves out internal reasoning blocks and the messages they emptied", async () => {
		const { body } = await requestOf(handlerFor(), [
			{ role: "user", content: "Hello" },
			{
				role: "assistant",
				content: [{ type: "reasoning", text: "internal" } as any, { type: "text", text: "Visible" }],
			},
			{ role: "assistant", content: [{ type: "reasoning", text: "only internal" } as any] },
			{ role: "user", content: "Continue" },
		])
		expect(body.messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"])
		expect(body.messages[1].content).toEqual([{ type: "text", text: "Visible" }])
	})

	it("reports a failed request to telemetry and rethrows it", async () => {
		const failure = new Error("overloaded")
		mocks.create.mockRejectedValueOnce(failure)
		await expect(requestOf(handlerFor())).rejects.toBe(failure)
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			message: "overloaded",
			provider: "Anthropic",
			modelId: "claude-sonnet-4-5",
			operation: "createMessage",
		})
	})
})

describe("completePrompt", () => {
	it("sends one non-streaming user message and returns the text with usage", async () => {
		const result = await handlerFor().completePromptWithUsage("Test prompt")
		expect(result).toMatchObject({ text: "Test response", usage: { inputTokens: 10, outputTokens: 5 } })
		expect(mocks.create).toHaveBeenCalledWith({
			model: "claude-sonnet-4-5",
			messages: [{ role: "user", content: "Test prompt" }],
			max_tokens: 8192,
			thinking: undefined,
			stream: false,
		})
	})

	it("sends the chosen effort level", async () => {
		await handlerFor({ apiModelId: "claude-sonnet-5-5", reasoningEffort: "medium" }).completePrompt("p")
		expect(mocks.create.mock.calls.at(-1)![0].output_config).toEqual({ effort: "medium" })
	})

	it.each([
		["no text block", [{ type: "image" }], ""],
		["a thinking block before the text", [{ type: "thinking" }, { type: "text", text: "visible" }], "visible"],
	])("returns the text for %s", async (_label, content, text) => {
		mocks.create.mockResolvedValueOnce({ content })
		expect(await handlerFor().completePrompt("p")).toBe(text)
	})

	it("reports a failed request to telemetry and rethrows it", async () => {
		mocks.create.mockRejectedValueOnce(new Error("API Error"))
		await expect(handlerFor().completePrompt("p")).rejects.toThrow("API Error")
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({ operation: "completePrompt" })
	})
})
