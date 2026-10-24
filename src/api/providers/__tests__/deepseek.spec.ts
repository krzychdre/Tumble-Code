// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/deepseek.spec.ts
// Stream reading (reasoning_content before the answer, tool calls, finish reasons) is pinned
// for the DeepSeek loop by chat-completions-characterization, DeepSeek's cache usage names by
// openai-cache-usage-shapes. This spec covers what DeepSeekHandler adds: the endpoint, model
// selection, the thinking toggle with the effort ladder, and the R1 message format.

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("openai", async () => {
	const { openAiModuleMock } = await import("./provider-test-helpers")
	return openAiModuleMock(mocks.create)
})

import OpenAI from "openai"
import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { calculateApiCost } from "@tumble-code/core/browser"
import { DEEP_SEEK_DEFAULT_TEMPERATURE, deepSeekDefaultModelId, deepSeekModels } from "@tumble-code/types"

import { DeepSeekHandler } from "../deepseek"
import { defaultOpenAiCreate } from "./provider-test-helpers"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new DeepSeekHandler({ deepSeekApiKey: "test-api-key", apiModelId: "deepseek-flash", ...options })
}

async function drain(stream: AsyncIterable<any>) {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

async function requestOf(options: Partial<ApiHandlerOptions>, messages: Anthropic.Messages.MessageParam[] = []) {
	await drain(handlerFor(options).createMessage("System", messages))
	return mocks.create.mock.calls.at(-1)![0]
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultOpenAiCreate)
})

describe("client", () => {
	it.each([
		["the DeepSeek API by default", {}, "https://api.deepseek.com", "test-api-key"],
		[
			"a custom base URL",
			{ deepSeekBaseUrl: "https://proxy.example.com/v1" },
			"https://proxy.example.com/v1",
			"test-api-key",
		],
		["a placeholder key", { deepSeekApiKey: undefined }, "https://api.deepseek.com", "not-provided"],
	])("talks to %s", async (_label, options, baseURL, apiKey) => {
		await drain(handlerFor(options).createMessage("s", []))
		expect(vi.mocked(OpenAI).mock.calls.at(-1)![0]).toMatchObject({ baseURL, apiKey })
	})
})

describe("getModel", () => {
	it.each([
		["the default model without an id", undefined, deepSeekDefaultModelId, deepSeekDefaultModelId],
		["a known model", "deepseek-v4-pro", "deepseek-v4-pro", "deepseek-v4-pro"],
		["a legacy Flash name as V4.1 Flash", "deepseek-v4-flash", "deepseek-v4-flash", "deepseek-flash"],
		[
			"an unknown id with the default model's info",
			"custom-deepseek-model",
			"custom-deepseek-model",
			deepSeekDefaultModelId,
		],
	])("resolves %s", (_label, apiModelId, id, infoOf) => {
		const model = handlerFor({ apiModelId }).getModel()
		expect(model.id).toBe(id)
		expect(model.info.contextWindow).toBe(deepSeekModels[infoOf as keyof typeof deepSeekModels].contextWindow)
	})

	it("uses DeepSeek's default temperature unless the user set one", () => {
		expect(handlerFor().getModel().temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
		expect(handlerFor({ modelTemperature: 0.7 }).getModel().temperature).toBe(0.7)
	})
})

describe("thinking and reasoning effort", () => {
	// The thinking toggle is keyed on model ids: the current names and the legacy Flash names
	// DeepSeek still serves (with V4.1 Flash) all get it.
	it.each(["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
		"%s thinks by default, at high, without temperature, with the 20% output cap",
		async (apiModelId) => {
			const body = await requestOf({ apiModelId })
			expect(body).toMatchObject({
				model: apiModelId,
				thinking: { type: "enabled" },
				reasoning_effort: "high",
				// 20% of the 1_048_576-token context window.
				max_completion_tokens: 209_716,
			})
			expect(body).not.toHaveProperty("temperature")
		},
	)

	it.each([
		["reasoning off", { enableReasoningEffort: false }],
		["effort disable", { reasoningEffort: "disable" }],
	])("%s sends thinking disabled, no effort and the default temperature", async (_label, options) => {
		const body = await requestOf(options as Partial<ApiHandlerOptions>)
		expect(body.thinking).toEqual({ type: "disabled" })
		expect(body).not.toHaveProperty("reasoning_effort")
		expect(body.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
	})

	// Since 2026-08-13 DeepSeek accepts low / high / max; our xhigh is the top of the list.
	it.each([
		["low", "low"],
		["medium", "high"],
		["high", "high"],
		["xhigh", "max"],
		// A level carried over from another model that DeepSeek's list does not offer is dropped.
		["minimal", undefined],
		["max", undefined],
	] as const)("sends effort %s as %s", async (reasoningEffort, sent) => {
		expect((await requestOf({ reasoningEffort })).reasoning_effort).toBe(sent)
	})

	// The retired names: deepseek-reasoner was the thinking mode and keeps thinking on (a
	// compatible endpoint may still serve it); deepseek-chat and custom ids get no thinking fields.
	it("keeps thinking on for the retired deepseek-reasoner name", async () => {
		const body = await requestOf({ apiModelId: "deepseek-reasoner" })
		expect(body.thinking).toEqual({ type: "enabled" })
		expect(body.reasoning_effort).toBe("high")
	})

	it.each(["deepseek-chat", "custom-deepseek-model"])("sends no thinking fields for %s", async (apiModelId) => {
		const body = await requestOf({ apiModelId, reasoningEffort: "high" })
		expect(body).not.toHaveProperty("thinking")
		expect(body).not.toHaveProperty("reasoning_effort")
		expect(body.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
	})

	it("sends the user's max tokens override", async () => {
		expect((await requestOf({ modelMaxTokens: 32_000 })).max_completion_tokens).toBe(32_000)
	})
})

describe("request", () => {
	const history = [
		{ role: "user", content: "Start" },
		{
			role: "assistant",
			reasoning_content: "thinking",
			content: [{ type: "tool_use", id: "call_1", name: "list_files", input: {} }],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "call_1", content: "a.ts" },
				{ type: "text", text: "<environment_details>x</environment_details>" },
			],
		},
	] as unknown as Anthropic.Messages.MessageParam[]

	it("puts the system prompt into the first user message and keeps the reasoning while thinking", async () => {
		const body = await requestOf({}, history)
		expect(body.messages).toEqual([
			{ role: "user", content: "System\nStart" },
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } }],
				reasoning_content: "thinking",
			},
			// Text after a tool result goes into the tool message: a user message there makes
			// DeepSeek drop the reasoning of the turn.
			{ role: "tool", tool_call_id: "call_1", content: "a.ts\n\n<environment_details>x</environment_details>" },
		])
	})

	it("keeps the post-tool text as a user message without thinking", async () => {
		const body = await requestOf({ enableReasoningEffort: false }, history)
		expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"user",
		])
	})

	it("streams with usage, the tools and parallel tool calls", async () => {
		const tools = [{ type: "function" as const, function: { name: "read_file", parameters: {} } }]
		await drain(
			handlerFor().createMessage("s", [], { taskId: "t", tools, tool_choice: "auto", parallelToolCalls: false }),
		)
		expect(mocks.create.mock.calls[0][0]).toMatchObject({
			stream: true,
			stream_options: { include_usage: true },
			tool_choice: "auto",
			parallel_tool_calls: false,
		})
	})

	it("prices the cache hits at the cache read price and the misses as input", async () => {
		const usage = {
			prompt_tokens: 1000,
			completion_tokens: 100,
			prompt_cache_hit_tokens: 600,
			prompt_cache_miss_tokens: 400,
		}
		mocks.create.mockResolvedValueOnce({
			async *[Symbol.asyncIterator]() {
				yield { choices: [{ delta: {}, finish_reason: "stop" }], usage }
			},
		})
		const chunks = await drain(handlerFor().createMessage("s", []))
		const info = deepSeekModels[deepSeekDefaultModelId]
		expect(chunks.find((chunk) => chunk.type === "usage")).toEqual({
			type: "usage",
			inputTokens: 1000,
			outputTokens: 100,
			cacheReadTokens: 600,
			totalCost: calculateApiCost("openai", info, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600 })
				.totalCost,
		})
	})

	it("names DeepSeek in a failed request", async () => {
		mocks.create.mockRejectedValueOnce(new Error("Insufficient Balance"))
		await expect(drain(handlerFor().createMessage("s", []))).rejects.toThrow(
			"DeepSeek completion error: Insufficient Balance",
		)
	})
})
