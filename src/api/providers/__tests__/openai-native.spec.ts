// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/openai-native.spec.ts
// The event processor and usage normalizer have unit specs in ../responses-api/__tests__; the
// handlers' shared stream and fallback behaviour is pinned in responses-api-characterization.
// This spec covers what OpenAiNativeHandler adds: the client, the request settings of both
// request paths, the price with the service tier and the one-shot completion.

const mocks = vi.hoisted(() => ({ create: vi.fn(), captureException: vi.fn() }))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: mocks.captureException } },
}))
vi.mock("openai", () => ({
	__esModule: true,
	default: vi.fn(function () {
		return { responses: { create: mocks.create } }
	}),
}))

import OpenAI from "openai"

import { calculateApiCost, type ApiHandlerOptions } from "@tumble-code/core/browser"
import { openAiNativeDefaultModelId, openAiNativeModels } from "@tumble-code/types"

import { OpenAiNativeHandler } from "../openai-native"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new OpenAiNativeHandler({ openAiNativeApiKey: "test-key", apiModelId: "gpt-5.4", ...options })
}

function sdkStream(events: unknown[]) {
	return {
		async *[Symbol.asyncIterator]() {
			yield* events
		},
	}
}

async function drain(stream: AsyncIterable<any>) {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

/** The body and request options of the last Responses API call, for either request path. */
async function requestOf(path: "createMessage" | "completePrompt", handler: OpenAiNativeHandler) {
	if (path === "createMessage") {
		mocks.create.mockResolvedValueOnce(sdkStream([]))
		await drain(handler.createMessage("You are a coder.", [{ role: "user", content: "Hi" }], { taskId: "task-1" }))
	} else {
		mocks.create.mockResolvedValueOnce({ output: [] })
		await handler.completePrompt("Hi")
	}
	const [body, requestOptions] = mocks.create.mock.calls.at(-1)!
	return { body, requestOptions }
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("client", () => {
	it.each([
		["the configured key and base URL", { openAiNativeBaseUrl: "https://proxy.example.com/v1" }, "test-key"],
		[
			"a placeholder key and the SDK default URL",
			{ openAiNativeApiKey: "", openAiNativeBaseUrl: "" },
			"not-provided",
		],
	])("is created with %s", (_label, options, apiKey) => {
		handlerFor(options)
		expect(vi.mocked(OpenAI).mock.calls.at(-1)![0]).toMatchObject({
			apiKey,
			baseURL: options.openAiNativeBaseUrl || undefined,
			defaultHeaders: {
				originator: "roo-code",
				session_id: expect.any(String),
				"User-Agent": expect.stringMatching(/^roo-code\//),
			},
		})
	})

	it("sends the task id as session_id, and the handler's session id without a task", async () => {
		const handler = handlerFor()
		const sessionId = (vi.mocked(OpenAI).mock.calls.at(-1)![0] as any).defaultHeaders.session_id

		const withTask = await requestOf("createMessage", handler)
		expect(withTask.requestOptions.headers.session_id).toBe("task-1")

		mocks.create.mockResolvedValueOnce(sdkStream([]))
		await drain(handler.createMessage("system", [{ role: "user", content: "Hi" }]))
		expect(mocks.create.mock.calls.at(-1)![1].headers.session_id).toBe(sessionId)
	})
})

describe("getModel", () => {
	it("resolves the selected id to its catalog entry", () => {
		const { id, info } = handlerFor({ apiModelId: "gpt-5.4" }).getModel()
		expect(id).toBe("gpt-5.4")
		expect(info).toEqual(openAiNativeModels["gpt-5.4"])
	})

	it("keeps an id the catalog does not have, with the default model's info", () => {
		// The settings UI warns that the id is unknown; the request still uses it.
		const { id, info } = handlerFor({ apiModelId: "o1" }).getModel()
		expect(id).toBe("o1")
		expect(info).toEqual(openAiNativeModels[openAiNativeDefaultModelId])
	})

	it("falls back to the default model when no id is set", () => {
		expect(handlerFor({ apiModelId: undefined }).getModel().id).toBe(openAiNativeDefaultModelId)
	})
})

// createMessage and completePrompt build their request settings separately; both must agree.
describe.each(["createMessage", "completePrompt"] as const)("%s request settings", (path) => {
	it.each([
		[
			"a reasoning model with its default effort and a summary",
			{ apiModelId: "gpt-5.1" },
			{
				include: ["reasoning.encrypted_content"],
				reasoning: { effort: "medium", summary: "auto" },
				text: { verbosity: "medium" },
				max_output_tokens: expect.any(Number),
				prompt_cache_retention: "24h",
			},
		],
		[
			"the chosen effort and verbosity, without a summary",
			{
				apiModelId: "gpt-5",
				reasoningEffort: "minimal",
				verbosity: "high",
				enableResponsesReasoningSummary: false,
			},
			{
				include: ["reasoning.encrypted_content"],
				reasoning: { effort: "minimal" },
				text: { verbosity: "high" },
				max_output_tokens: expect.any(Number),
			},
		],
		[
			"a supported service tier",
			{ apiModelId: "gpt-5.4", openAiNativeServiceTier: "flex", reasoningEffort: "disable" },
			{ text: { verbosity: "medium" }, max_output_tokens: expect.any(Number), service_tier: "flex" },
		],
		[
			"a chat model with the default temperature and no reasoning",
			{ apiModelId: "gpt-4.1" },
			{ temperature: 0, max_output_tokens: expect.any(Number) },
		],
		[
			"a chat model with the user's temperature and the always allowed default tier",
			{ apiModelId: "gpt-4.1", modelTemperature: 0.7, openAiNativeServiceTier: "default" },
			{ temperature: 0.7, max_output_tokens: expect.any(Number), service_tier: "default" },
		],
		[
			"a chat model without a tier it does not offer",
			{ apiModelId: "gpt-4.1", openAiNativeServiceTier: "flex" },
			{ temperature: 0, max_output_tokens: expect.any(Number) },
		],
	])("%s", async (_label, options, expected) => {
		const { body } = await requestOf(path, handlerFor(options as Partial<ApiHandlerOptions>))
		const { model, input, stream, store, instructions, tools, tool_choice, parallel_tool_calls, ...settings } = body
		expect(settings).toEqual(expected)
		expect(store).toBe(false)
		expect(stream).toBe(path === "createMessage")
	})

	// A reasoning effort saved for one model must not be sent to a model that
	// rejects it: GPT-6 Astra answers `none` with HTTP 400.
	it.each([
		["gpt-6-astra", "none", "medium"],
		["gpt-6-astra", "disable", "medium"],
		["gpt-6-astra", "minimal", "medium"],
		["gpt-6-astra", "xhigh", "xhigh"],
		["gpt-6-sol", "none", "none"],
		["gpt-6-luna", "minimal", "medium"],
		["gpt-5.6-sol", "disable", undefined],
	])("sends a supported reasoning effort for %s when %s is configured", async (apiModelId, configured, expected) => {
		const { body } = await requestOf(path, handlerFor({ apiModelId, reasoningEffort: configured as any }))
		expect(body.reasoning?.effort).toBe(expected)
	})
})

describe("createMessage", () => {
	it("prices usage with the tier the server reports, else the requested one", async () => {
		const usage = { input_tokens: 1000, output_tokens: 200 }
		const tokens = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }
		const info = openAiNativeModels["gpt-5.4"]
		const costOf = async (serviceTier?: string) => {
			mocks.create.mockResolvedValueOnce(
				sdkStream([
					{
						type: "response.completed",
						response: { usage, ...(serviceTier && { service_tier: serviceTier }) },
					},
				]),
			)
			const chunks = await drain(
				handlerFor({ openAiNativeServiceTier: "flex" }).createMessage("s", [{ role: "user", content: "Hi" }]),
			)
			return chunks.find((chunk) => chunk.type === "usage").totalCost
		}

		expect(await costOf("priority")).toBe(
			calculateApiCost("openai", info, tokens, { serviceTier: "priority" }).totalCost,
		)
		expect(await costOf()).toBe(calculateApiCost("openai", info, tokens, { serviceTier: "flex" }).totalCost)
		expect(await costOf()).not.toBe(await costOf("priority"))
	})

	it.each([
		["the OpenAI API", {}, "https://api.openai.com/v1/responses"],
		[
			"a custom base URL",
			{ openAiNativeBaseUrl: "https://proxy.example.com" },
			"https://proxy.example.com/v1/responses",
		],
	])("falls back to a plain fetch of %s when the SDK has no Responses API", async (_label, options, url) => {
		const fetchMock = vi.fn(
			async () => new Response('data: {"type":"response.output_text.delta","delta":"Hi"}\n\n'),
		)
		vi.stubGlobal("fetch", fetchMock)
		try {
			const handler = handlerFor(options)
			Reflect.set(handler, "client", {})
			const chunks = await drain(
				handler.createMessage("s", [{ role: "user", content: "Hi" }], { taskId: "task-9" }),
			)

			expect(chunks).toEqual([{ type: "text", text: "Hi" }])
			const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
			expect(calledUrl).toBe(url)
			expect(init.headers).toMatchObject({
				"Content-Type": "application/json",
				Authorization: "Bearer test-key",
				originator: "roo-code",
				session_id: "task-9",
			})
			expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-5.4", stream: true, instructions: "s" })
		} finally {
			vi.unstubAllGlobals()
		}
	})
})

describe("completePrompt", () => {
	it("sends the prompt as one input message and returns the first output text with usage", async () => {
		mocks.create.mockResolvedValueOnce({
			output: [
				{ type: "reasoning" },
				{ type: "message", content: [{ type: "refusal" }, { type: "output_text", text: "the answer" }] },
			],
			usage: { input_tokens: 7, output_tokens: 3 },
		})
		const result = await handlerFor().completePromptWithUsage("Test prompt")

		expect(result).toMatchObject({ text: "the answer", usage: { inputTokens: 7, outputTokens: 3 } })
		const [body, requestOptions] = mocks.create.mock.calls[0]
		expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Test prompt" }] }])
		expect(requestOptions.signal).toBeInstanceOf(AbortSignal)
	})

	it.each([
		["the top-level text", { output: [], text: "fallback text" }, "fallback text"],
		["no text at all", { output: [{ type: "message", content: [] }] }, ""],
	])("returns %s", async (_label, response, text) => {
		mocks.create.mockResolvedValueOnce(response)
		expect(await handlerFor().completePrompt("p")).toBe(text)
	})

	it("is aborted by cancelRequest", async () => {
		const handler = handlerFor()
		mocks.create.mockImplementationOnce(
			(_body, { signal }) =>
				new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
		)
		const pending = handler.completePrompt("p")
		handler.cancelRequest()
		await expect(pending).rejects.toThrow("aborted")
	})

	it("reports the failure to telemetry and throws it with the provider prefix", async () => {
		mocks.create.mockRejectedValueOnce(new Error("API Error"))
		await expect(handlerFor({ apiModelId: "gpt-4.1" }).completePrompt("p")).rejects.toThrow(
			"OpenAI Native completion error: API Error",
		)
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			message: "API Error",
			provider: "OpenAI Native",
			modelId: "gpt-4.1",
			operation: "completePrompt",
		})
	})
})
