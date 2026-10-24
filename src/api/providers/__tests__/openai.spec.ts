// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/openai.spec.ts
// Stream reading (text, reasoning fields, think tags, tool call partials, usage once at the
// end) is pinned for both request paths by chat-completions-characterization and the
// streamChatCompletion spec; usage field names by openai-cache-usage-shapes; the compact
// profile by openai.compact.spec. This spec covers what OpenAiHandler adds: the client per
// endpoint kind, the request body of each path, the GLM thinking switch, completePrompt,
// cancellation and the model list.

const mocks = vi.hoisted(() => ({ create: vi.fn(), logInfo: vi.fn() }))

vi.mock("openai", () => {
	const client = () => ({ chat: { completions: { create: mocks.create } } })
	return {
		__esModule: true,
		default: vi.fn(function () {
			return client()
		}),
		AzureOpenAI: vi.fn(function () {
			return client()
		}),
	}
})
vi.mock("axios", () => ({ default: { get: vi.fn() } }))
vi.mock("../utils/timeout-config", async (importOriginal) => ({
	...(await importOriginal<typeof import("../utils/timeout-config")>()),
	getApiRequestTimeout: vi.fn(() => 600_000),
}))
vi.mock("../../../utils/logging", () => ({ logger: { info: mocks.logInfo, error: vi.fn(), warn: vi.fn() } }))

import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import {
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
	openAiModelInfoSaneDefaults,
} from "@tumble-code/types"

import { OpenAiHandler, getOpenAiModels } from "../openai"
import { DEFAULT_HEADERS } from "../constants"
import { wireCaptureFetch } from "../utils/wire-capture"
import { defaultOpenAiCreate } from "./provider-test-helpers"

const baseOptions: ApiHandlerOptions = {
	openAiApiKey: "test-api-key",
	openAiModelId: "gpt-4",
	openAiBaseUrl: "https://api.openai.com/v1",
}

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new OpenAiHandler({ ...baseOptions, ...options })
}

async function drain(stream: AsyncIterable<any>) {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

/** Body and request options of one createMessage call. */
async function requestOf(
	options: Partial<ApiHandlerOptions> = {},
	messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }],
	metadata?: Parameters<OpenAiHandler["createMessage"]>[2],
) {
	await drain(handlerFor(options).createMessage("System", messages, metadata))
	const [body, requestOptions] = mocks.create.mock.calls.at(-1)!
	return { body, requestOptions }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultOpenAiCreate)
})

describe("client", () => {
	const lastConfig = (ctor: unknown) => vi.mocked(ctor as typeof OpenAI).mock.calls.at(-1)![0] as Record<string, any>

	it("is created lazily, once, with the defaults and the user's headers", async () => {
		const handler = handlerFor({ openAiBaseUrl: "", openAiApiKey: "", openAiHeaders: { "X-Team": "a" } })
		expect(OpenAI).not.toHaveBeenCalled()

		await handler.completePrompt("p")
		await handler.completePrompt("p")

		expect(OpenAI).toHaveBeenCalledTimes(1)
		expect(lastConfig(OpenAI)).toEqual({
			baseURL: "https://api.openai.com/v1",
			apiKey: "not-provided",
			defaultHeaders: { ...DEFAULT_HEADERS, "X-Team": "a" },
			timeout: 600_000,
			fetch: wireCaptureFetch,
		})
	})

	it.each([
		["an azure.com host", { openAiBaseUrl: "https://my.openai.azure.com" }, "2024-08-01-preview"],
		[
			"the Azure switch",
			{ openAiBaseUrl: "https://gateway.example.com", openAiUseAzure: true, azureApiVersion: "2025-01-01" },
			"2025-01-01",
		],
	])("uses AzureOpenAI for %s", async (_label, options, apiVersion) => {
		await handlerFor(options).completePrompt("p")
		expect(AzureOpenAI).toHaveBeenCalledTimes(1)
		expect(lastConfig(AzureOpenAI)).toMatchObject({ baseURL: options.openAiBaseUrl, apiVersion, timeout: 600_000 })
		expect(OpenAI).not.toHaveBeenCalled()
	})

	it.each(["https://x.services.ai.azure.com/models", "https://x.services.ai.azure.com:443/models"])(
		"sends the Azure AI Inference api-version and path for %s",
		async (openAiBaseUrl) => {
			const { requestOptions } = await requestOf({ openAiBaseUrl })
			expect(lastConfig(OpenAI).defaultQuery).toEqual({ "api-version": "2024-05-01-preview" })
			expect(requestOptions.path).toBe(OPENAI_AZURE_AI_INFERENCE_PATH)
		},
	)
})

describe("getModel", () => {
	it("uses the sane defaults and an empty id without settings", () => {
		const { id, info } = new OpenAiHandler({}).getModel()
		expect(id).toBe("")
		expect(info).toEqual(openAiModelInfoSaneDefaults)
	})

	it("reports preserveReasoning in the custom info only when reasoning is returned", () => {
		const custom = { openAiCustomModelInfo: { contextWindow: 1000, supportsPromptCache: false } }
		expect(handlerFor(custom).getModel().info).toEqual(custom.openAiCustomModelInfo)
		expect(handlerFor({ ...custom, openAiPreserveReasoning: true }).getModel().info).toEqual({
			...custom.openAiCustomModelInfo,
			preserveReasoning: true,
		})
	})
})

describe("createMessage request", () => {
	it("streams with usage, the tools and the task signal", async () => {
		const signal = new AbortController().signal
		const tools = [
			{
				type: "function" as const,
				function: { name: "read_file", parameters: { type: "object", properties: {} } },
			},
		]
		const { body, requestOptions } = await requestOf({}, undefined, {
			taskId: "t",
			signal,
			tools,
			tool_choice: "auto",
		})

		expect(body).toMatchObject({
			model: "gpt-4",
			messages: [
				{ role: "system", content: "System" },
				{ role: "user", content: "Hello" },
			],
			stream: true,
			stream_options: { include_usage: true },
			tool_choice: "auto",
			parallel_tool_calls: true,
		})
		expect(body.tools.map((tool: any) => tool.function.name)).toEqual(["read_file"])
		expect(requestOptions.signal.aborted).toBe(false)
		expect(requestOptions).not.toHaveProperty("path")
	})

	it("turns parallel tool calls off when the task asks", async () => {
		const { body } = await requestOf({}, undefined, { taskId: "t", parallelToolCalls: false })
		expect(body.parallel_tool_calls).toBe(false)
	})

	it.each([
		["omitted by default", {}, undefined],
		["the user's value", { modelTemperature: 0.7 }, 0.7],
		["a user's 0", { modelTemperature: 0 }, 0],
		[
			"the DeepSeek default for deepseek-reasoner",
			{ openAiModelId: "deepseek-reasoner" },
			DEEP_SEEK_DEFAULT_TEMPERATURE,
		],
		[
			"omitted for a model without temperature",
			{
				modelTemperature: 0.7,
				openAiCustomModelInfo: { contextWindow: 1000, supportsPromptCache: false, supportsTemperature: false },
			},
			undefined,
		],
	])("temperature is %s", async (_label, options, temperature) => {
		const { body } = await requestOf(options as Partial<ApiHandlerOptions>)
		expect(body.temperature).toBe(temperature)
	})

	it.each([
		["the user's max tokens", { includeMaxTokens: true, modelMaxTokens: 32000 }, 32000],
		[
			"the model's max tokens",
			{
				includeMaxTokens: true,
				openAiCustomModelInfo: { contextWindow: 1000, maxTokens: 4096, supportsPromptCache: false },
			},
			4096,
		],
		["nothing with includeMaxTokens off", { includeMaxTokens: false, modelMaxTokens: 32000 }, undefined],
	])("max_completion_tokens is %s", async (_label, options, expected) => {
		const { body } = await requestOf(options as Partial<ApiHandlerOptions>)
		expect(body.max_completion_tokens).toBe(expected)
		expect(body).not.toHaveProperty("max_tokens")
	})

	it.each([
		[true, "medium"],
		[false, undefined],
	])("reasoning effort enabled %s sends reasoning_effort %s", async (enableReasoningEffort, effort) => {
		const { body } = await requestOf({
			enableReasoningEffort,
			reasoningEffort: "medium",
			openAiCustomModelInfo: { contextWindow: 1000, supportsPromptCache: false, supportsReasoningEffort: true },
		})
		expect(body.reasoning_effort).toBe(effort)
	})

	// x.ai and its subdomains reject stream_options; a substring test once also caught box.ai.
	it.each([
		["https://api.x.ai/v1", false],
		["https://custom.x.ai/v1", false],
		["https://api.x.ai:8443/v1", false],
		["https://box.ai/v1", true],
		["https://api.notx.ai/v1", true],
	])("stream_options for %s: %s", async (openAiBaseUrl, sent) => {
		for (const openAiModelId of ["gpt-4", "o3-mini"]) {
			const { body } = await requestOf({ openAiBaseUrl, openAiModelId })
			expect("stream_options" in body).toBe(sent)
		}
	})

	it("marks the system prompt and the last text of the last two user messages for caching", async () => {
		const image = {
			type: "image" as const,
			source: { type: "base64" as const, media_type: "image/png" as const, data: "AA==" },
		}
		const { body } = await requestOf(
			{ openAiCustomModelInfo: { contextWindow: 1000, supportsPromptCache: true } },
			[
				{ role: "user", content: "first" },
				{ role: "assistant", content: "answer" },
				{ role: "user", content: [{ type: "text", text: "second" }, image] },
				{ role: "assistant", content: "answer" },
				{ role: "user", content: [image] },
			],
		)
		const ephemeral = { type: "ephemeral" }
		expect(body.messages[0].content).toEqual([{ type: "text", text: "System", cache_control: ephemeral }])
		expect(body.messages[1].content).toBe("first")
		expect(body.messages[3].content[0]).toEqual({ type: "text", text: "second", cache_control: ephemeral })
		// A message without text gets a placeholder text part to carry the breakpoint.
		expect(body.messages[5].content.at(-1)).toEqual({ type: "text", text: "...", cache_control: ephemeral })
	})

	describe("returning reasoning to the model", () => {
		// The history as the task sends it with reasoning kept: the stored reasoning block first in
		// the assistant message, environment details after the tool result.
		const history = [
			{ role: "user", content: "Pick a number and remember it." },
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "I pick 483729.", summary: [] },
					{ type: "text", text: "Picked." },
					{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "call_1", content: "file body" },
					{ type: "text", text: "<environment_details>ctx</environment_details>" },
				],
			},
		] as unknown as Anthropic.Messages.MessageParam[]

		it("sends no reasoning when the setting is off", async () => {
			const { body } = await requestOf({}, history)
			const assistant = body.messages.find((message: { role: string }) => message.role === "assistant")
			expect(assistant).not.toHaveProperty("reasoning_content")
			expect(assistant).not.toHaveProperty("reasoning")
		})

		it.each([true, false])("sends it under both field names (streaming: %s)", async (openAiStreamingEnabled) => {
			const { body } = await requestOf({ openAiPreserveReasoning: true, openAiStreamingEnabled }, history)
			expect(body.messages).toEqual([
				{ role: "system", content: "System" },
				{ role: "user", content: "Pick a number and remember it." },
				{
					role: "assistant",
					content: "Picked.",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "read_file", arguments: '{"path":"a.ts"}' },
						},
					],
					reasoning_content: "I pick 483729.",
					reasoning: "I pick 483729.",
				},
				// Text after a tool result goes into the tool message: a user message there would make
				// the server drop the reasoning of the turn.
				{
					role: "tool",
					tool_call_id: "call_1",
					content: "file body\n\n<environment_details>ctx</environment_details>",
				},
			])
		})

		it("leaves deepseek-reasoner's format alone: the system prompt is the first user message", async () => {
			const { body } = await requestOf(
				{ openAiModelId: "deepseek-reasoner", openAiPreserveReasoning: true },
				history,
			)
			expect(body.messages[0]).toEqual({ role: "user", content: "System\nPick a number and remember it." })
			expect(body.messages.some((message: { role: string }) => message.role === "system")).toBe(false)
		})

		it("does not cache deepseek-reasoner's messages", async () => {
			const { body } = await requestOf({
				openAiModelId: "deepseek-reasoner",
				openAiCustomModelInfo: { contextWindow: 1000, supportsPromptCache: true },
			})
			expect(JSON.stringify(body.messages)).not.toContain("cache_control")
		})
	})

	it("sends a non-streaming request and yields its tool calls, text and usage", async () => {
		mocks.create.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "read_file", arguments: '{"path":"a"}' },
							},
							{ id: "call_2", type: "custom", custom: { name: "x", input: "" } },
						],
					},
				},
			],
			usage: { prompt_tokens: 3, completion_tokens: 4 },
		})
		const handler = handlerFor({ openAiStreamingEnabled: false, includeMaxTokens: true, modelMaxTokens: 100 })
		const chunks = await drain(handler.createMessage("System", [{ role: "user", content: "Hi" }]))

		const body = mocks.create.mock.calls[0][0]
		expect(body).not.toHaveProperty("stream")
		expect(body.max_completion_tokens).toBe(100)
		expect(chunks).toEqual([
			{ type: "tool_call", id: "call_1", name: "read_file", arguments: '{"path":"a"}' },
			{ type: "text", text: "" },
			expect.objectContaining({ type: "usage", inputTokens: 3, outputTokens: 4 }),
		])
	})

	it.each([
		["streaming", {}],
		["non-streaming", { openAiStreamingEnabled: false }],
	])("rethrows a failed %s request once prefixed, keeping the status", async (_label, options) => {
		mocks.create.mockRejectedValueOnce(Object.assign(new Error("Rate limit exceeded"), { status: 429 }))
		await expect(drain(handlerFor(options).createMessage("s", []))).rejects.toMatchObject({
			message: "OpenAI completion error: Rate limit exceeded",
			status: 429,
		})
	})

	it("logs the raw usage only with ROO_LOG_RAW_USAGE=1", async () => {
		await drain(handlerFor().createMessage("s", []))
		expect(mocks.logInfo).not.toHaveBeenCalled()

		vi.stubEnv("ROO_LOG_RAW_USAGE", "1")
		try {
			await drain(handlerFor().createMessage("s", []))
		} finally {
			vi.unstubAllEnvs()
		}
		expect(mocks.logInfo).toHaveBeenCalledWith(expect.stringContaining('raw usage: {"prompt_tokens":10'))
	})
})

describe("o-series request", () => {
	it.each([
		["streaming", {}, { stream: true, stream_options: { include_usage: true } }],
		["non-streaming", { openAiStreamingEnabled: false }, {}],
	])("sends a %s request with the developer prompt and the model's effort", async (_label, options, streamFields) => {
		const { body } = await requestOf({
			openAiModelId: "o3-mini",
			includeMaxTokens: true,
			modelMaxTokens: 32000,
			modelTemperature: 0.5,
			openAiCustomModelInfo: { contextWindow: 1000, supportsPromptCache: false, reasoningEffort: "high" },
			...options,
		})
		expect(body).toEqual({
			model: "o3-mini",
			messages: [
				{ role: "developer", content: "Formatting re-enabled\nSystem" },
				{ role: "user", content: "Hello" },
			],
			reasoning_effort: "high",
			temperature: undefined,
			tools: undefined,
			tool_choice: undefined,
			parallel_tool_calls: true,
			max_completion_tokens: 32000,
			...streamFields,
		})
	})

	it("uses the Azure AI Inference path", async () => {
		const { requestOptions } = await requestOf({
			openAiModelId: "o3-mini",
			openAiBaseUrl: "https://x.services.ai.azure.com/models",
		})
		expect(requestOptions.path).toBe(OPENAI_AZURE_AI_INFERENCE_PATH)
	})
})

describe("GLM thinking", () => {
	const glmInfo = {
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsPromptCache: false,
		supportsReasoningEffort: true,
	}

	it.each([
		["reasoning on", "glm-4.7", { enableReasoningEffort: true, reasoningEffort: "low" }, { type: "enabled" }],
		[
			"reasoning on and returned",
			"glm-4.7",
			{ enableReasoningEffort: true, reasoningEffort: "none", openAiPreserveReasoning: true },
			{ type: "enabled", clear_thinking: false },
		],
		[
			"reasoning off, even when returned",
			"glm-4.7",
			{ enableReasoningEffort: false, openAiPreserveReasoning: true },
			{ type: "disabled" },
		],
		// GLM-5.3 rejects thinking: disabled, so it stays enabled.
		["GLM-5.3 with reasoning off", "glm-5.3", { enableReasoningEffort: false }, { type: "enabled" }],
		[
			"GLM-5.3 with reasoning off and returned",
			"GLM-5.3-Flash",
			{ enableReasoningEffort: false, openAiPreserveReasoning: true },
			{ type: "enabled", clear_thinking: false },
		],
		["a non-GLM model", "gpt-4-turbo", { enableReasoningEffort: true }, undefined],
	])("%s (%s)", async (_label, openAiModelId, options, thinking) => {
		for (const openAiStreamingEnabled of [true, false]) {
			const { body } = await requestOf({
				openAiModelId,
				openAiCustomModelInfo: glmInfo,
				openAiStreamingEnabled,
				...options,
			} as Partial<ApiHandlerOptions>)
			expect(body.thinking).toEqual(thinking)
		}
	})

	it.each(["glm-4.5-air", "GLM-4.5-Flash", "glm-4.6", "GLM-4.6-Pro", "GLM-5-Pro"])(
		"recognizes %s",
		async (openAiModelId) => {
			const { body } = await requestOf({
				openAiModelId,
				openAiCustomModelInfo: glmInfo,
				enableReasoningEffort: true,
				reasoningEffort: "high",
			})
			expect(body.thinking).toEqual({ type: "enabled" })
		},
	)

	it("passes a max effort through literally", async () => {
		const { body } = await requestOf({
			openAiModelId: "glm-5.3",
			enableReasoningEffort: true,
			reasoningEffort: "max",
			openAiCustomModelInfo: { ...glmInfo, supportsReasoningEffort: ["low", "high", "max"] },
		})
		expect(body.reasoning_effort).toBe("max")
	})
})

describe("completePrompt", () => {
	it("sends the prompt as one user message and returns the text with usage", async () => {
		const result = await handlerFor({ includeMaxTokens: true, modelMaxTokens: 50 }).completePromptWithUsage(
			"Test prompt",
		)
		expect(result).toMatchObject({ text: "Test response", usage: { inputTokens: 10, outputTokens: 5 } })
		expect(mocks.create.mock.calls[0][0]).toEqual({
			model: "gpt-4",
			messages: [{ role: "user", content: "Test prompt" }],
			max_completion_tokens: 50,
		})
	})

	it("returns empty text when the answer has none", async () => {
		mocks.create.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] })
		expect(await handlerFor().completePrompt("p")).toBe("")
	})

	// The error was wrapped twice once ("OpenAI completion error: OpenAI completion error: ...")
	// and the outer wrap dropped the HTTP status.
	it("wraps a failure once and keeps the status", async () => {
		mocks.create.mockRejectedValueOnce(Object.assign(new Error("API Error"), { status: 500 }))
		await expect(handlerFor().completePrompt("p")).rejects.toMatchObject({
			message: "OpenAI completion error: API Error",
			status: 500,
		})
	})
})

describe("cancelRequest", () => {
	it("aborts the request in flight", async () => {
		const handler = handlerFor()
		mocks.create.mockImplementationOnce(
			(_body, { signal }) =>
				new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
		)
		const pending = handler.completePrompt("p")
		handler.cancelRequest()
		await expect(pending).rejects.toThrow("aborted")
	})

	it.each([
		[false, 1],
		[true, 2],
	])("with destroyClient %s builds the client %i time(s) for two requests", async (destroyClient, clients) => {
		const handler = handlerFor()
		await handler.completePrompt("p")
		handler.cancelRequest(destroyClient)
		await handler.completePrompt("p")
		expect(OpenAI).toHaveBeenCalledTimes(clients)
	})
})

describe("getOpenAiModels", () => {
	const get = vi.mocked(axios.get)

	it.each([undefined, "", "  not a url  "])("returns no models without a usable base URL (%o)", async (baseUrl) => {
		expect(await getOpenAiModels(baseUrl, "key")).toEqual([])
		expect(get).not.toHaveBeenCalled()
	})

	it("requests the trimmed URL with the auth, the user's headers and the control timeout, and dedupes", async () => {
		get.mockResolvedValueOnce({ data: { data: [{ id: "gpt-4" }, { id: "gpt-4" }, { id: "o3" }] } })
		const models = await getOpenAiModels("  https://api.example.com/v1  ", "key", { "X-Team": "a" })

		expect(models).toEqual(["gpt-4", "o3"])
		expect(get).toHaveBeenCalledWith("https://api.example.com/v1/models", {
			timeout: 30_000,
			headers: { ...DEFAULT_HEADERS, "X-Team": "a", Authorization: "Bearer key" },
		})
	})

	it("sends no Authorization header without a key", async () => {
		get.mockResolvedValueOnce({ data: {} })
		expect(await getOpenAiModels("https://api.example.com/v1")).toEqual([])
		expect(get.mock.calls[0][1]!.headers).not.toHaveProperty("Authorization")
	})

	it("returns no models when the request fails", async () => {
		get.mockRejectedValueOnce(new Error("Network error"))
		expect(await getOpenAiModels("https://api.example.com/v1", "key")).toEqual([])
	})
})
