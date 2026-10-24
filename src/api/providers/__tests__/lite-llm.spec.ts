// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/lite-llm.spec.ts
// Stream reading is pinned for the LiteLLM loop by chat-completions-characterization and the
// usage field names by the completion-usage spec. This spec covers what LiteLLMHandler adds:
// prompt cache marks, the max tokens field per model, temperature, the Gemini thought
// signature, tool id normalization, the price with the fetched model info and its errors.

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("../utils/timeout-config", () => ({ getApiRequestTimeout: vi.fn().mockReturnValue(600_000) }))
vi.mock("openai", async () => {
	const { openAiModuleMock } = await import("./provider-test-helpers")
	return openAiModuleMock(mocks.create)
})
vi.mock("../fetchers/modelCache", async () => {
	const { litellmDefaultModelInfo } = await import("@tumble-code/types")
	// Every id the tests ask for is listed.
	const special: Record<string, unknown> = {
		// What the LiteLLM fetcher builds for DeepSeek: no cache write price.
		"deepseek-chat": {
			maxTokens: 8192,
			contextWindow: 128_000,
			supportsPromptCache: true,
			inputPrice: 0.27,
			outputPrice: 1.1,
			cacheReadsPrice: 0.07,
		},
	}
	// An id containing "no-max" has no max tokens in its info.
	const models = new Proxy(special, {
		get: (target, id: string) =>
			target[id] ?? { ...litellmDefaultModelInfo, maxTokens: id.includes("no-max") ? undefined : 8192 },
	})
	return { getModels: vi.fn(async () => models), getModelsFromCache: vi.fn(() => undefined) }
})

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { litellmDefaultModelId } from "@tumble-code/types"

import { LiteLLMHandler } from "../lite-llm"
import { getModels } from "../fetchers/modelCache"
import { sanitizeOpenAiCallId } from "../../../utils/tool-id"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new LiteLLMHandler({
		litellmApiKey: "test-key",
		litellmBaseUrl: "http://litellm.local:4000",
		litellmModelId: litellmDefaultModelId,
		...options,
	})
}

function streamOf(chunks: unknown[]) {
	return {
		withResponse: vi.fn().mockResolvedValue({
			data: {
				async *[Symbol.asyncIterator]() {
					yield* chunks
				},
			},
		}),
	}
}

async function drain(stream: AsyncIterable<any>) {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

async function requestOf(
	options: Partial<ApiHandlerOptions>,
	messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }],
	metadata?: Parameters<LiteLLMHandler["createMessage"]>[2],
) {
	await drain(handlerFor(options).createMessage("System", messages, metadata))
	const [body, requestOptions] = mocks.create.mock.calls.at(-1)!
	return { body, requestOptions }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation((body: { stream?: boolean }) =>
		body.stream ? streamOf([]) : Promise.resolve({ choices: [{ message: { content: "answer" } }] }),
	)
})

describe("client and model list", () => {
	it.each([
		["the configured server and key", {}, "http://litellm.local:4000", "test-key"],
		[
			"the local default server and a dummy key",
			{ litellmBaseUrl: "", litellmApiKey: "" },
			"http://localhost:4000",
			"dummy-key",
		],
	])("uses %s", async (_label, options, baseURL, apiKey) => {
		await drain(handlerFor(options).createMessage("s", []))
		expect(vi.mocked(OpenAI).mock.calls.at(-1)![0]).toMatchObject({ baseURL, apiKey })
		expect(getModels).toHaveBeenCalledWith(expect.objectContaining({ provider: "litellm" }))
	})
})

describe("createMessage request", () => {
	it("streams with usage, the tools and the task signal, without cache marks by default", async () => {
		const signal = new AbortController().signal
		const tools = [{ type: "function" as const, function: { name: "read_file", parameters: {} } }]
		const { body, requestOptions } = await requestOf({}, undefined, {
			taskId: "t",
			signal,
			tools,
			tool_choice: "auto",
		})
		expect(body).toMatchObject({
			model: litellmDefaultModelId,
			messages: [
				{ role: "system", content: "System" },
				{ role: "user", content: "Hello" },
			],
			stream: true,
			stream_options: { include_usage: true },
			tool_choice: "auto",
			max_tokens: 8192,
			temperature: 0,
		})
		expect(body.tools.map((tool: any) => tool.function.name)).toEqual(["read_file"])
		expect(requestOptions).toEqual({ signal })
	})

	it("marks the system prompt and the last two user messages when prompt caching is on", async () => {
		const ephemeral = { type: "ephemeral" }
		const { body } = await requestOf({ litellmUsePromptCache: true }, [
			{ role: "user", content: "first" },
			{ role: "assistant", content: "answer" },
			{
				role: "user",
				content: [
					{ type: "text", text: "second" },
					{ type: "text", text: "details" },
				],
			},
			{ role: "assistant", content: "answer" },
			{ role: "user", content: "third" },
		])
		expect(body.messages).toEqual([
			{ role: "system", content: [{ type: "text", text: "System", cache_control: ephemeral }] },
			{ role: "user", content: "first" },
			{ role: "assistant", content: "answer" },
			{
				role: "user",
				content: [
					{ type: "text", text: "second" },
					{ type: "text", text: "details", cache_control: ephemeral },
				],
			},
			{ role: "assistant", content: "answer" },
			{ role: "user", content: [{ type: "text", text: "third", cache_control: ephemeral }] },
		])
	})

	// GPT-5 rejects the deprecated max_tokens; gpt-50 and the like are not GPT-5.
	it.each([
		["gpt-5", "max_completion_tokens"],
		["gpt5", "max_completion_tokens"],
		["GPT-5", "max_completion_tokens"],
		["gpt-5-turbo", "max_completion_tokens"],
		["gpt5-preview", "max_completion_tokens"],
		["gpt-5.1", "max_completion_tokens"],
		["openai/gpt-5-mini", "max_completion_tokens"],
		["gpt-50", "max_tokens"],
		["gpt-4", "max_tokens"],
	])("%s gets its limit as %s on both request kinds", async (litellmModelId, field) => {
		const { body } = await requestOf({ litellmModelId })
		await handlerFor({ litellmModelId }).completePrompt("p")
		const completion = mocks.create.mock.calls.at(-1)![0]
		for (const request of [body, completion]) {
			expect(request[field]).toBe(8192)
			expect(Object.keys(request).filter((key) => key.startsWith("max_"))).toEqual([field])
		}
	})

	it.each(["gpt-5-no-max", "llama-no-max"])(
		"sends no limit when the model info has none (%s)",
		async (litellmModelId) => {
			const { body } = await requestOf({ litellmModelId })
			expect(Object.keys(body).filter((key) => key.startsWith("max_"))).toEqual([])
		},
	)

	it.each([
		["the user's temperature", "gpt-4", { modelTemperature: 0.7 }, 0.7],
		["none to o3-mini", "openai/o3-mini", { modelTemperature: 0.7 }, undefined],
	])("sends %s", async (_label, litellmModelId, options, temperature) => {
		const { body } = await requestOf({ litellmModelId, ...options })
		expect(body.temperature).toBe(temperature)
	})

	it("normalizes tool call ids to OpenAI's limit", async () => {
		const longId = "toolu_" + "x".repeat(80)
		const { body } = await requestOf({}, [
			{ role: "user", content: "go" },
			{ role: "assistant", content: [{ type: "tool_use", id: longId, name: "read_file", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: longId, content: "ok" }] },
		])
		expect(body.messages[2].tool_calls[0].id).toBe(sanitizeOpenAiCallId(longId))
		expect(body.messages[3].tool_call_id).toBe(sanitizeOpenAiCallId(longId))
	})

	describe("Gemini thought signature", () => {
		const signature = Buffer.from("skip_thought_signature_validator").toString("base64")
		const history: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "go" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call_1", name: "read_file", input: {} },
					{ type: "tool_use", id: "call_2", name: "list_files", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "call_1", content: "a" },
					{ type: "tool_result", tool_use_id: "call_2", content: "b" },
				],
			},
		]

		// Gemini 2.5 and later validate thought signatures, under any LiteLLM prefix or model group name.
		it.each([
			["gemini-2.5-pro", true],
			["gemini-3-pro-preview", true],
			["gemini-3.8-flash", true],
			["gemini-10-ultra", true],
			["vertex_ai/gemini-4-argon", true],
			["openrouter/google/gemini-3.1-pro-preview", true],
			["Gemini 3 Pro", true],
			["google/gemini 2.5 pro", true],
			["gemini-2.0-flash", false],
			["gemini/gemini-1.5-pro", false],
			["gemini-flash-latest", false],
			["gemma-3-27b-it", false],
			["notgemini-4", false],
			["claude-3-opus", false],
		])("%s gets the skip signature on every tool call: %s", async (litellmModelId, injected) => {
			const { body } = await requestOf({ litellmModelId }, history)
			const toolCalls = body.messages.find((message: any) => message.tool_calls).tool_calls
			expect(toolCalls.map((call: any) => call.provider_specific_fields?.thought_signature)).toEqual(
				injected ? [signature, signature] : [undefined, undefined],
			)
		})
	})
})

describe("createMessage usage", () => {
	// LiteLLM copies DeepSeek's prompt_cache_hit_tokens into cached_tokens and also forwards
	// prompt_cache_miss_tokens; a miss is ordinary input, never a cache write (DEF-C40).
	it("prices the usage with the fetched model info", async () => {
		mocks.create.mockReturnValueOnce(
			streamOf([
				{
					choices: [{ delta: { content: "ok" } }],
					usage: {
						prompt_tokens: 1000,
						completion_tokens: 50,
						prompt_tokens_details: { cached_tokens: 800 },
						prompt_cache_hit_tokens: 800,
						prompt_cache_miss_tokens: 200,
					},
				},
			]),
		)
		const chunks = await drain(handlerFor({ litellmModelId: "deepseek-chat" }).createMessage("s", []))
		const usage = chunks.find((chunk) => chunk.type === "usage")
		expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800 })
		expect(usage.cacheWriteTokens).toBeUndefined()
		// 200 misses at 0.27, 800 hits at 0.07, 50 output at 1.1 (per million).
		expect(usage.totalCost).toBeCloseTo((200 * 0.27 + 800 * 0.07 + 50 * 1.1) / 1_000_000, 12)
	})

	it("prefixes a failed stream", async () => {
		mocks.create.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(new Error("proxy down")) })
		await expect(drain(handlerFor().createMessage("s", []))).rejects.toThrow("LiteLLM streaming error: proxy down")
	})
})

describe("completePrompt", () => {
	it("sends the prompt as one user message and returns the text", async () => {
		expect(await handlerFor({ modelTemperature: 0.4 }).completePrompt("Test prompt")).toBe("answer")
		expect(mocks.create.mock.calls.at(-1)![0]).toEqual({
			model: litellmDefaultModelId,
			messages: [{ role: "user", content: "Test prompt" }],
			temperature: 0.4,
			max_tokens: 8192,
		})
	})

	it("returns empty text for an answer without content", async () => {
		mocks.create.mockResolvedValueOnce({ choices: [] })
		expect(await handlerFor().completePrompt("p")).toBe("")
	})

	it("prefixes a failure", async () => {
		mocks.create.mockRejectedValueOnce(new Error("bad gateway"))
		await expect(handlerFor().completePrompt("p")).rejects.toThrow("LiteLLM completion error: bad gateway")
	})
})
