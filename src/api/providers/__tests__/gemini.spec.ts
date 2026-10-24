// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/gemini.spec.ts
// The stream mapping and the request contents are pinned against the real @google/genai client
// by gemini-wire-characterization, tool schemas and tool_choice by gemini-handler.spec. This
// spec covers model selection, the price, completePrompt and the error paths.

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: mocks.captureException } },
}))

import { t } from "i18next"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { type ModelInfo, geminiDefaultModelId, geminiModels } from "@tumble-code/types"

import { GeminiHandler, resolveGeminiModel } from "../gemini"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	const handler = new GeminiHandler({ geminiApiKey: "test-key", apiModelId: geminiDefaultModelId, ...options })
	const models = { generateContentStream: vi.fn(), generateContent: vi.fn() }
	handler["client"] = { models } as any
	return { handler, models }
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("getModel", () => {
	it.each([
		["an unknown id", "invalid-model"],
		["a custom id (#227)", "gemini-9.9-nonexistent"],
		["an inherited object key", "toString"],
	])("keeps %s with the default model's limits and no prices", (_label, apiModelId) => {
		const { id, info } = handlerFor({ apiModelId }).handler.getModel()
		expect(id).toBe(apiModelId)
		expect(info.contextWindow).toBe(geminiModels[geminiDefaultModelId].contextWindow)
		expect([info.inputPrice, info.outputPrice, info.cacheReadsPrice, info.cacheWritesPrice, info.tiers]).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		])
	})

	it("prefers the edit tool over apply_diff, once", () => {
		const { info } = handlerFor().handler.getModel()
		expect(info.excludedTools!.filter((tool) => tool === "apply_diff")).toEqual(["apply_diff"])
		expect(info.includedTools!.filter((tool) => tool === "edit")).toEqual(["edit"])
	})

	it("reports the same model without building a handler", () => {
		const options = { apiModelId: "gemini-3.5-flash" }
		const { id, info } = handlerFor(options).handler.getModel()
		expect(resolveGeminiModel(options)).toEqual({ id, info })
	})
})

describe("calculateCost", () => {
	const info: ModelInfo = {
		inputPrice: 1,
		outputPrice: 4,
		cacheReadsPrice: 0.25,
		contextWindow: 1_000_000,
		supportsPromptCache: true,
	}
	const cost = (tokens: Partial<Parameters<GeminiHandler["calculateCost"]>[0]>, modelInfo = info) =>
		handlerFor().handler.calculateCost({ info: modelInfo, inputTokens: 0, outputTokens: 0, ...tokens })

	it.each([
		["input and output", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 5],
		// Cached tokens are part of the prompt count (the OpenAI protocol).
		["cache reads inside the input", { inputTokens: 1_000_000, cacheReadTokens: 400_000 }, 0.6 + 0.1],
		["thinking tokens as output", { outputTokens: 500_000, reasoningTokens: 500_000 }, 4],
		["no tokens", {}, 0],
	])("prices %s", (_label, tokens, expected) => {
		expect(cost(tokens)).toBeCloseTo(expected, 10)
	})

	it("is unknown without an output price", () => {
		expect(cost({ inputTokens: 1000 }, { ...info, outputPrice: undefined })).toBeUndefined()
	})
})

describe("createMessage", () => {
	it("sends the system instruction, the default temperature, the base URL and the task signal", async () => {
		const { handler, models } = handlerFor({ googleGeminiBaseUrl: "https://proxy.example.com" })
		models.generateContentStream.mockResolvedValue((async function* () {})())
		const signal = new AbortController().signal
		for await (const _chunk of handler.createMessage("System", [{ role: "user", content: "Hi" }], {
			taskId: "t",
			signal,
		})) {
			// drain
		}
		expect(models.generateContentStream.mock.calls[0][0]).toMatchObject({
			model: geminiDefaultModelId,
			config: {
				systemInstruction: "System",
				temperature: 1,
				httpOptions: { baseUrl: "https://proxy.example.com" },
				abortSignal: signal,
			},
		})
	})

	it("reads text from a chunk without candidates and prices the last usage", async () => {
		const { handler, models } = handlerFor()
		models.generateContentStream.mockResolvedValue(
			(async function* () {
				yield { text: "Hello" }
				yield { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 } }
			})(),
		)
		const chunks = []
		for await (const chunk of handler.createMessage("s", [])) {
			chunks.push(chunk)
		}
		const info = handler.getModel().info
		expect(chunks).toEqual([
			{ type: "text", text: "Hello" },
			{
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: undefined,
				reasoningTokens: 2,
				totalCost: handler.calculateCost({ info, inputTokens: 10, outputTokens: 5, reasoningTokens: 2 }),
			},
		])
	})

	it("reports a failure to telemetry and throws the translated message", async () => {
		const { handler, models } = handlerFor()
		models.generateContentStream.mockRejectedValue(new Error("Gemini API error"))
		await expect(handler.createMessage("s", []).next()).rejects.toThrow(
			t("common:errors.gemini.generate_stream", { error: "Gemini API error" }),
		)
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			message: "Gemini API error",
			provider: "Gemini",
			modelId: geminiDefaultModelId,
			operation: "createMessage",
		})
	})
})

describe("completePrompt", () => {
	it("sends the prompt with the model's temperature and returns the text with usage", async () => {
		const { handler, models } = handlerFor({ modelTemperature: 0.4 })
		models.generateContent.mockResolvedValue({
			text: "Test response",
			usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
		})
		expect(await handler.completePromptWithUsage("Test prompt")).toMatchObject({
			text: "Test response",
			usage: { inputTokens: 3, outputTokens: 2 },
		})
		expect(models.generateContent).toHaveBeenCalledWith({
			model: geminiDefaultModelId,
			contents: [{ role: "user", parts: [{ text: "Test prompt" }] }],
			config: { httpOptions: undefined, temperature: 0.4 },
		})
	})

	it("appends the grounding sources as citations", async () => {
		const { handler, models } = handlerFor()
		models.generateContent.mockResolvedValue({
			text: "Answer",
			candidates: [
				{
					groundingMetadata: {
						groundingChunks: [
							{ web: { uri: "https://a.example" } },
							{ web: null },
							{ web: { uri: "https://b.example" } },
						],
					},
				},
			],
		})
		expect(await handler.completePrompt("p")).toBe(
			`Answer\n\n${t("common:errors.gemini.sources")} [1](https://a.example), [2](https://b.example)`,
		)
	})

	it("returns empty text without an answer or sources", async () => {
		const { handler, models } = handlerFor()
		models.generateContent.mockResolvedValue({ candidates: [{ groundingMetadata: { groundingChunks: [] } }] })
		expect(await handler.completePrompt("p")).toBe("")
	})

	it("reports a failure to telemetry and throws the translated message", async () => {
		const { handler, models } = handlerFor()
		models.generateContent.mockRejectedValue(new Error("Gemini completion error"))
		await expect(handler.completePrompt("p")).rejects.toThrow(
			t("common:errors.gemini.generate_complete_prompt", { error: "Gemini completion error" }),
		)
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({ operation: "completePrompt" })
	})
})
