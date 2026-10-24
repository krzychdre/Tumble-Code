// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/minimax.spec.ts
// Stream mapping and cost: transform/anthropic-stream.spec and the protocol characterization
// (MiniMax is one of its handlers, with the cache placement); the environment-details merge:
// transform/__tests__/minimax-format.spec. This spec covers what MiniMaxHandler adds: the
// endpoint, model selection, sampling, tools and tool_choice, and completePrompt.

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("@anthropic-ai/sdk", async () => {
	const { anthropicModuleMock } = await import("./provider-test-helpers")
	return anthropicModuleMock(mocks.create)
})

import { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { minimaxDefaultModelId, minimaxModels } from "@tumble-code/types"

import { MiniMaxHandler } from "../minimax"
import { defaultAnthropicCreate } from "./provider-test-helpers"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new MiniMaxHandler({ minimaxApiKey: "test-minimax-key", ...options })
}

async function requestOf(
	options: Partial<ApiHandlerOptions> = {},
	metadata?: Parameters<MiniMaxHandler["createMessage"]>[2],
) {
	for await (const _chunk of handlerFor(options).createMessage(
		"System",
		[{ role: "user", content: "Hello" }],
		metadata,
	)) {
		// drain
	}
	return mocks.create.mock.calls.at(-1)!
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultAnthropicCreate)
})

describe("client", () => {
	// The settings schema allows only the two MiniMax /v1 URLs.
	it.each([
		[undefined, "https://api.minimax.io/anthropic"],
		["https://api.minimax.io/v1", "https://api.minimax.io/anthropic"],
		["https://api.minimaxi.com/v1", "https://api.minimaxi.com/anthropic"],
	] as const)("sends requests for %s to %s", (minimaxBaseUrl, baseURL) => {
		handlerFor({ minimaxBaseUrl })
		expect(vi.mocked(Anthropic).mock.calls.at(-1)![0]).toMatchObject({ baseURL, apiKey: "test-minimax-key" })
	})
})

describe("getModel", () => {
	it.each([
		["the default model without an id", undefined, minimaxDefaultModelId, minimaxDefaultModelId],
		["a known model", "MiniMax-M2", "MiniMax-M2", "MiniMax-M2"],
	])("resolves %s", (_label, apiModelId, id, infoOf) => {
		const model = handlerFor({ apiModelId }).getModel()
		expect(model.id).toBe(id)
		expect(model.info).toEqual(minimaxModels[infoOf as keyof typeof minimaxModels])
	})
})

describe("createMessage request", () => {
	it("sends the capped max tokens, temperature 1 and the cache marks, with the task signal", async () => {
		const signal = new AbortController().signal
		const [body, requestOptions] = await requestOf({ apiModelId: "MiniMax-M2" }, { taskId: "t", signal })
		const info = minimaxModels["MiniMax-M2"]
		expect(body).toMatchObject({
			model: "MiniMax-M2",
			max_tokens: Math.min(info.maxTokens, Math.ceil(info.contextWindow * 0.2)),
			temperature: 1,
			stream: true,
			system: [{ text: "System", type: "text", cache_control: { type: "ephemeral" } }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] },
			],
		})
		expect(requestOptions).toEqual({ signal })
	})

	it("sends the user's temperature", async () => {
		const [body] = await requestOf({ modelTemperature: 0.3 })
		expect(body.temperature).toBe(0.3)
	})

	it("converts the tools", async () => {
		const tools = [
			{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } },
		] as OpenAI.Chat.ChatCompletionTool[]
		const [body] = await requestOf({}, { taskId: "t", tools })
		expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(["read_file"])
	})

	it.each([
		["nothing without a choice", undefined, undefined],
		["nothing for none", "none", undefined],
		["auto", "auto", { type: "auto" }],
		["any for required", "required", { type: "any" }],
		["the named tool", { type: "function", function: { name: "read_file" } }, { type: "tool", name: "read_file" }],
		["auto for an unknown string", "sometimes", { type: "auto" }],
		["auto for an unknown object", { type: "custom" }, { type: "auto" }],
	])("maps tool_choice to %s", async (_label, tool_choice, expected) => {
		const [body] = await requestOf({}, { taskId: "t", tool_choice: tool_choice as any })
		expect(body.tool_choice).toEqual(expected)
	})
})

describe("completePrompt", () => {
	it("sends one user message and returns the text with usage", async () => {
		const result = await handlerFor({ modelTemperature: 0.4 }).completePromptWithUsage("Test prompt")
		expect(result).toMatchObject({ text: "Test response", usage: { inputTokens: 10, outputTokens: 5 } })
		expect(mocks.create.mock.calls.at(-1)![0]).toEqual({
			model: minimaxDefaultModelId,
			max_tokens: 16_384,
			temperature: 0.4,
			messages: [{ role: "user", content: "Test prompt" }],
			stream: false,
		})
	})

	it("returns empty text without a text block", async () => {
		mocks.create.mockResolvedValueOnce({ content: [{ type: "thinking", thinking: "x" }] })
		expect(await handlerFor().completePrompt("p")).toBe("")
	})
})
