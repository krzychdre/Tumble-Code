// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/anthropic-vertex.spec.ts
// Stream mapping and the Vertex cache breakpoints: transform/__tests__/anthropic-stream.spec,
// transform/caching/__tests__/vertex.spec and the protocol characterization. This spec covers
// what AnthropicVertexHandler adds: the client and credentials, model selection, the request
// fields and the Google credential error text.

vi.mock("../utils/timeout-config", () => ({ getApiRequestTimeout: vi.fn().mockReturnValue(600_000) }))

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("@anthropic-ai/vertex-sdk", async () => {
	const { anthropicVertexModuleMock } = await import("./provider-test-helpers")
	return anthropicVertexModuleMock(mocks.create)
})

import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import type OpenAI from "openai"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"

import { AnthropicVertexHandler } from "../anthropic-vertex"
import { wireCaptureFetch } from "../utils/wire-capture"
import { defaultAnthropicCreate } from "./provider-test-helpers"

const SONNET_45 = "claude-sonnet-4-5@20250929"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new AnthropicVertexHandler({
		apiModelId: SONNET_45,
		vertexProjectId: "test-project",
		vertexRegion: "us-central1",
		...options,
	})
}

async function requestOf(
	handler: AnthropicVertexHandler,
	metadata?: Parameters<AnthropicVertexHandler["createMessage"]>[2],
) {
	for await (const _chunk of handler.createMessage("System", [{ role: "user", content: "Hello" }], metadata)) {
		// drain
	}
	const [body, requestOptions] = mocks.create.mock.calls.at(-1)!
	return { body, requestOptions }
}

function lastClientConfig() {
	return vi.mocked(AnthropicVertex).mock.calls.at(-1)![0] as Record<string, any>
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultAnthropicCreate)
})

describe("client", () => {
	it("is created for the project and region with the wire-capturing fetch", () => {
		handlerFor()
		expect(lastClientConfig()).toMatchObject({
			projectId: "test-project",
			region: "us-central1",
			timeout: 600_000,
			fetch: wireCaptureFetch,
		})
	})

	it("defaults the project and the region", () => {
		handlerFor({ vertexProjectId: undefined, vertexRegion: undefined })
		expect(lastClientConfig()).toMatchObject({ projectId: "not-provided", region: "us-east5" })
	})

	it.each([
		[
			"JSON credentials",
			{ vertexJsonCredentials: JSON.stringify({ type: "service_account", client_email: "a@b.c" }) },
			{ jsonContent: { type: "service_account", client_email: "a@b.c" } },
		],
		["a key file", { vertexKeyFile: "/keys/vertex.json" }, { keyFilename: "/keys/vertex.json" }],
	])("authenticates with %s", (_label, options, expected) => {
		handlerFor(options)
		expect(lastClientConfig().googleAuth).toMatchObject(expected)
	})
})

describe("getModel", () => {
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
		["claude-sonnet-4@20250514", true, { contextWindow: 1_000_000, inputPrice: 6.0, outputPrice: 22.5 }, true],
		[SONNET_45, true, { contextWindow: 1_000_000, inputPrice: 6.0, outputPrice: 22.5 }, true],
		[SONNET_45, false, { contextWindow: 200_000, inputPrice: 3.0, outputPrice: 15.0 }, false],
		["claude-haiku-4-5@20251001", true, { contextWindow: 200_000 }, false],
		["claude-sonnet-4-6", true, { contextWindow: 1_000_000, inputPrice: 3.0, outputPrice: 15.0 }, false],
		["claude-opus-4-8", true, { contextWindow: 1_000_000, inputPrice: 5.0, outputPrice: 25.0 }, false],
	])("%s with the 1M flag %s: %o, beta %s", (apiModelId, vertex1MContext, info, beta) => {
		const model = handlerFor({ apiModelId, vertex1MContext }).getModel()
		expect(model.info).toMatchObject(info)
		expect(model.betas).toEqual(beta ? ["context-1m-2025-08-07"] : undefined)
	})
})

describe("createMessage request", () => {
	it("caches the system prompt and the user message and passes the task signal", async () => {
		const signal = new AbortController().signal
		const { body, requestOptions } = await requestOf(handlerFor(), { taskId: "t", signal })
		expect(body).toMatchObject({
			model: SONNET_45,
			max_tokens: 8192,
			stream: true,
			system: [{ text: "System", type: "text", cache_control: { type: "ephemeral" } }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] },
			],
		})
		expect(requestOptions).toEqual({ signal })
	})

	it("sends the 1M beta header when it is on", async () => {
		const { requestOptions } = await requestOf(handlerFor({ apiModelId: SONNET_45, vertex1MContext: true }))
		expect(requestOptions.headers).toEqual({ "anthropic-beta": "context-1m-2025-08-07" })
	})

	it.each([
		[
			"budget thinking on a hybrid model",
			{ enableReasoningEffort: true, modelMaxTokens: 16384, modelMaxThinkingTokens: 4096 },
			{ type: "enabled", budget_tokens: 4096 },
			undefined,
		],
		[
			"adaptive thinking on Fable 5",
			{ apiModelId: "claude-fable-5", enableReasoningEffort: true },
			{ type: "adaptive" },
			undefined,
		],
		[
			"adaptive thinking with the chosen effort",
			{ apiModelId: "claude-opus-4-8", enableReasoningEffort: true, reasoningEffort: "max" },
			{ type: "adaptive" },
			{ effort: "max" },
		],
		[
			"no thinking but the chosen effort with the toggle off",
			{ apiModelId: "claude-sonnet-5-5", enableReasoningEffort: false, reasoningEffort: "low" },
			undefined,
			{ effort: "low" },
		],
		["no effort when unset", { apiModelId: "claude-opus-5-5" }, undefined, undefined],
		[
			"no effort the model does not offer",
			{ apiModelId: "claude-sonnet-4-6", reasoningEffort: "xhigh" },
			undefined,
			undefined,
		],
		["no effort for a model without levels", { reasoningEffort: "high" }, undefined, undefined],
	])("sends %s", async (_label, options, thinking, outputConfig) => {
		const { body } = await requestOf(handlerFor(options as Partial<ApiHandlerOptions>))
		expect(body.thinking).toEqual(thinking)
		expect(body.output_config).toEqual(outputConfig)
	})

	it.each(["claude-fable-5", "claude-sonnet-5-5", "claude-opus-4-8"])(
		"sends no temperature to %s",
		async (apiModelId) => {
			const { body } = await requestOf(handlerFor({ apiModelId, enableReasoningEffort: true }))
			expect(body).not.toHaveProperty("temperature")
		},
	)

	it("converts the tools and tool_choice", async () => {
		const tools: OpenAI.Chat.ChatCompletionTool[] = [
			{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } },
		]
		const { body } = await requestOf(handlerFor(), { taskId: "t", tools, tool_choice: "auto" })
		expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(["get_weather"])
		expect(body.tool_choice).toMatchObject({ type: "auto" })
	})

	it("leaves out internal reasoning blocks", async () => {
		for await (const _chunk of handlerFor().createMessage("System", [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: [{ type: "reasoning", text: "internal" } as any] },
			{ role: "user", content: "Continue" },
		])) {
			// drain
		}
		expect(mocks.create.mock.calls.at(-1)![0].messages.map((message: any) => message.role)).toEqual([
			"user",
			"user",
		])
	})
})

describe("completePrompt", () => {
	it("sends the prompt as a cached text block and returns the text with usage", async () => {
		const result = await handlerFor().completePromptWithUsage("Test prompt")
		expect(result).toMatchObject({ text: "Test response", usage: { inputTokens: 10, outputTokens: 5 } })
		expect(mocks.create).toHaveBeenCalledWith({
			model: SONNET_45,
			max_tokens: 8192,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Test prompt", cache_control: { type: "ephemeral" } }],
				},
			],
			stream: false,
		})
	})

	it("sends the thinking and the chosen effort", async () => {
		await handlerFor({
			apiModelId: "claude-opus-5",
			enableReasoningEffort: true,
			reasoningEffort: "high",
		}).completePrompt("p")
		expect(mocks.create.mock.calls.at(-1)![0]).toMatchObject({
			thinking: { type: "adaptive" },
			output_config: { effort: "high" },
		})
	})

	it.each([
		["no text block", [{ type: "image" }], ""],
		["an empty content list", [], ""],
		[
			"a thinking block before the text",
			[
				{ type: "thinking", thinking: "x" },
				{ type: "text", text: "visible" },
			],
			"visible",
		],
	])("returns the text for %s", async (_label, content, text) => {
		mocks.create.mockResolvedValueOnce({ content })
		expect(await handlerFor().completePrompt("p")).toBe(text)
	})

	it("prefixes a failure with the provider name", async () => {
		mocks.create.mockRejectedValueOnce(new Error("Vertex API error"))
		await expect(handlerFor().completePrompt("p")).rejects.toThrow("Vertex completion error: Vertex API error")
	})
})

// Since vertex-sdk 0.19 the real reason of a failed credential lookup is only on `cause`.
describe("Google credential errors", () => {
	const credentialError = () =>
		new Error("Failed to acquire Google OAuth credentials.", { cause: new Error("ENOENT: no key file") })

	it("puts the cause into the createMessage error", async () => {
		mocks.create.mockRejectedValueOnce(credentialError())
		await expect(requestOf(handlerFor())).rejects.toThrow(
			"Failed to acquire Google OAuth credentials. ENOENT: no key file",
		)
	})

	it("puts the cause into the completePrompt error once", async () => {
		const error = credentialError()
		error.message = "Failed to acquire Google OAuth credentials. ENOENT: no key file"
		mocks.create.mockRejectedValueOnce(error)
		await expect(handlerFor().completePrompt("p")).rejects.toMatchObject({
			message: "Vertex completion error: Failed to acquire Google OAuth credentials. ENOENT: no key file",
		})
	})
})
