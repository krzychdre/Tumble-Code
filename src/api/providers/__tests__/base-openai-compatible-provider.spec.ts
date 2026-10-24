// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/base-openai-compatible-provider.spec.ts
// Stream reading (think tags, reasoning_content, tool call partials, finish reasons, usage) is
// streamChatCompletion's and pinned for this loop by chat-completions-characterization. This
// spec covers what the base class adds: the client, the request params and cancellation.

const mocks = vi.hoisted(() => ({ create: vi.fn(), logInfo: vi.fn() }))

vi.mock("openai", async () => {
	const { openAiModuleMock } = await import("./provider-test-helpers")
	return openAiModuleMock(mocks.create)
})
vi.mock("../utils/timeout-config", async (importOriginal) => ({
	...(await importOriginal<typeof import("../utils/timeout-config")>()),
	getApiRequestTimeout: vi.fn(() => 600_000),
}))
vi.mock("../../../utils/logging", () => ({ logger: { info: mocks.logInfo, error: vi.fn(), warn: vi.fn() } }))

import OpenAI from "openai"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import type { ModelInfo } from "@tumble-code/types"

import { BaseOpenAiCompatibleProvider } from "../base-openai-compatible-provider"
import { DEFAULT_HEADERS } from "../constants"
import { wireCaptureFetch } from "../utils/wire-capture"
import { defaultOpenAiCreate } from "./provider-test-helpers"

const testModels: Record<string, ModelInfo> = {
	"test-model": { maxTokens: 4096, contextWindow: 128_000, supportsPromptCache: false },
	"binary-model": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsPromptCache: false,
		supportsReasoningBinary: true,
		defaultTemperature: 0.6,
	},
}

class TestProvider extends BaseOpenAiCompatibleProvider<string> {
	constructor(options: Partial<ApiHandlerOptions> = {}, sendsParallelToolCalls = true) {
		super({
			apiKey: "test-api-key",
			...options,
			providerName: "TestProvider",
			baseURL: "https://test.example.com/v1",
			defaultProviderModelId: "test-model",
			providerModels: testModels,
			defaultTemperature: 0.2,
		})
		Object.assign(this, { sendsParallelToolCalls })
	}
}

async function drain(stream: AsyncIterable<unknown>) {
	for await (const _chunk of stream) {
		// drain
	}
}

async function streamParamsOf(handler: TestProvider, metadata?: Parameters<TestProvider["createMessage"]>[2]) {
	await drain(handler.createMessage("System", [{ role: "user", content: "Hello" }], metadata))
	const [body, requestOptions] = mocks.create.mock.calls.at(-1)!
	return { body, requestOptions }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultOpenAiCreate)
})

it("requires an API key", () => {
	expect(() => new TestProvider({ apiKey: "" })).toThrow("API key is required")
})

it("builds the client for the provider's URL with the default headers and the request timeout", () => {
	new TestProvider()
	expect(vi.mocked(OpenAI).mock.calls.at(-1)![0]).toEqual({
		baseURL: "https://test.example.com/v1",
		apiKey: "test-api-key",
		defaultHeaders: DEFAULT_HEADERS,
		timeout: 600_000,
		fetch: wireCaptureFetch,
	})
})

describe("streamed request", () => {
	it("sends the clamped max tokens, the provider's default temperature, usage and the tools", async () => {
		const tools = [{ type: "function" as const, function: { name: "read_file", parameters: {} } }]
		const { body } = await streamParamsOf(new TestProvider(), { taskId: "t", tools, tool_choice: "auto" })
		expect(body).toMatchObject({
			model: "test-model",
			max_tokens: 4096,
			temperature: 0.2,
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
		expect(body).not.toHaveProperty("thinking")
	})

	it.each([
		["the user's temperature", { modelTemperature: 0.9 }, 0.9],
		["the model's default temperature", { apiModelId: "binary-model" }, 0.6],
	])("sends %s", async (_label, options, temperature) => {
		const { body } = await streamParamsOf(new TestProvider(options))
		expect(body.temperature).toBe(temperature)
	})

	it.each([
		["on for a binary model with reasoning on", "binary-model", true, { type: "enabled" }],
		["absent with reasoning off", "binary-model", false, undefined],
		["absent for a model without the switch", "test-model", true, undefined],
	])("the thinking switch is %s", async (_label, apiModelId, enableReasoningEffort, thinking) => {
		const handler = new TestProvider({ apiModelId, enableReasoningEffort })
		const { body } = await streamParamsOf(handler)
		expect(body.thinking).toEqual(thinking)
		await handler.completePrompt("p")
		expect(mocks.create.mock.calls.at(-1)![0].thinking).toEqual(thinking)
	})

	it.each([
		["the caller's choice", true, { taskId: "t", parallelToolCalls: false }, false],
		["nothing when the API has no such field", false, { taskId: "t" }, undefined],
	])("parallel_tool_calls is %s", async (_label, sendsParallelToolCalls, metadata, expected) => {
		const { body } = await streamParamsOf(new TestProvider({}, sendsParallelToolCalls), metadata)
		expect(body.parallel_tool_calls).toBe(expected)
	})

	it("aborts the request with the task's signal and gives every request its own signal", async () => {
		const task = new AbortController()
		const handler = new TestProvider()
		const first = await streamParamsOf(handler, { taskId: "t", signal: task.signal })
		const second = await streamParamsOf(handler)
		expect(first.requestOptions.signal).not.toBe(second.requestOptions.signal)

		task.abort()
		expect(first.requestOptions.signal.aborted).toBe(true)
		expect(second.requestOptions.signal.aborted).toBe(false)
	})

	it("logs the raw usage only with ROO_LOG_RAW_USAGE=1", async () => {
		await streamParamsOf(new TestProvider())
		expect(mocks.logInfo).not.toHaveBeenCalled()

		vi.stubEnv("ROO_LOG_RAW_USAGE", "1")
		try {
			await streamParamsOf(new TestProvider())
		} finally {
			vi.unstubAllEnvs()
		}
		expect(mocks.logInfo).toHaveBeenCalledWith(expect.stringMatching(/^\[TestProvider\] raw usage: \{/))
	})
})

describe("completePrompt", () => {
	it("sends the prompt as one user message and returns the text with usage", async () => {
		const result = await new TestProvider().completePromptWithUsage("Test prompt")
		expect(result).toMatchObject({ text: "Test response", usage: { inputTokens: 10, outputTokens: 5 } })
		expect(mocks.create.mock.calls[0][0]).toEqual({
			model: "test-model",
			messages: [{ role: "user", content: "Test prompt" }],
		})
	})

	it("wraps a failure with the provider name", async () => {
		mocks.create.mockRejectedValueOnce(new Error("boom"))
		await expect(new TestProvider().completePrompt("p")).rejects.toThrow("TestProvider completion error: boom")
	})
})

describe("cancelRequest", () => {
	it("aborts the request in flight", async () => {
		const handler = new TestProvider()
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
	])("with destroyClient %s has built %i client(s) after the next request", async (destroyClient, clients) => {
		const handler = new TestProvider()
		handler.cancelRequest(destroyClient)
		await handler.completePrompt("p")
		expect(OpenAI).toHaveBeenCalledTimes(clients)
	})
})
