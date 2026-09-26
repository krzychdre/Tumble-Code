// npx vitest run src/api/providers/__tests__/minimax.spec.ts

vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn().mockReturnValue({
			get: vitest.fn().mockReturnValue(600), // Default timeout in seconds
		}),
	},
}))

import { Anthropic } from "@anthropic-ai/sdk"

import { type MinimaxModelId, minimaxDefaultModelId, minimaxModels } from "@roo-code/types"

import { MiniMaxHandler } from "../minimax"

vitest.mock("@anthropic-ai/sdk", () => {
	const mockCreate = vitest.fn()
	return {
		Anthropic: vitest.fn(function () {
			return {
				messages: {
					create: mockCreate,
				},
			}
		}),
	}
})

describe("MiniMaxHandler", () => {
	let handler: MiniMaxHandler
	let mockCreate: any

	beforeEach(() => {
		vitest.clearAllMocks()
		const anthropicInstance = (Anthropic as unknown as any)()
		mockCreate = anthropicInstance.messages.create
	})

	describe("International MiniMax (default)", () => {
		beforeEach(() => {
			handler = new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimax.io/v1",
			})
		})

		it("should use the correct international MiniMax base URL by default", () => {
			new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
				}),
			)
		})

		it("should convert /v1 endpoint to /anthropic endpoint", () => {
			new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimax.io/v1",
			})
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
				}),
			)
		})

		it("should use the provided API key", () => {
			const minimaxApiKey = "test-minimax-api-key"
			new MiniMaxHandler({ minimaxApiKey })
			expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: minimaxApiKey }))
		})

		it("should return default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toEqual(minimaxModels[minimaxDefaultModelId])
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
		})

		it("should return MiniMax-M2.5 model with correct configuration", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2.5"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
			expect(model.info.contextWindow).toBe(204_800)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.cacheWritesPrice).toBe(0.375)
			expect(model.info.cacheReadsPrice).toBe(0.03)
		})

		it("should return MiniMax-M2 model with correct configuration", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
			expect(model.info.contextWindow).toBe(204_800)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.cacheWritesPrice).toBe(0.375)
			expect(model.info.cacheReadsPrice).toBe(0.03)
		})

		it("should return MiniMax-M2-Stable model with correct configuration", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2-Stable"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
			expect(model.info.contextWindow).toBe(204_800)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.cacheWritesPrice).toBe(0.375)
			expect(model.info.cacheReadsPrice).toBe(0.03)
		})
	})

	describe("China MiniMax", () => {
		beforeEach(() => {
			handler = new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimaxi.com/v1",
			})
		})

		it("should use the correct China MiniMax base URL", () => {
			new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimaxi.com/v1",
			})
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({ baseURL: "https://api.minimaxi.com/anthropic" }),
			)
		})

		it("should convert China /v1 endpoint to /anthropic endpoint", () => {
			new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimaxi.com/v1",
			})
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({ baseURL: "https://api.minimaxi.com/anthropic" }),
			)
		})

		it("should use the provided API key for China", () => {
			const minimaxApiKey = "test-minimax-api-key"
			new MiniMaxHandler({ minimaxApiKey, minimaxBaseUrl: "https://api.minimaxi.com/v1" })
			expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: minimaxApiKey }))
		})

		it("should return default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toEqual(minimaxModels[minimaxDefaultModelId])
		})
	})

	describe("Default behavior", () => {
		it("should default to international base URL when none is specified", () => {
			const handlerDefault = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
				}),
			)

			const model = handlerDefault.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toEqual(minimaxModels[minimaxDefaultModelId])
		})

		it("should default to MiniMax-M2.7 model", () => {
			const handlerDefault = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
			const model = handlerDefault.getModel()
			expect(model.id).toBe("MiniMax-M2.7")
		})
	})

	describe("API Methods", () => {
		beforeEach(() => {
			handler = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
		})

		it("completePrompt method should return text from MiniMax API", async () => {
			const expectedResponse = "This is a test response from MiniMax"
			mockCreate.mockResolvedValueOnce({
				content: [{ type: "text", text: expectedResponse }],
			})
			const result = await handler.completePrompt("test prompt")
			expect(result).toBe(expectedResponse)
		})

		it("should handle errors in completePrompt", async () => {
			const errorMessage = "MiniMax API error"
			mockCreate.mockRejectedValueOnce(new Error(errorMessage))
			await expect(handler.completePrompt("test prompt")).rejects.toThrow()
		})

		it("createMessage should yield text content from stream", async () => {
			const testContent = "This is test content from MiniMax stream"

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_start",
								index: 0,
								content_block: { type: "text", text: testContent },
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "text", text: testContent })
		})

		it("createMessage should yield usage data from stream", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "message_start",
								message: {
									usage: {
										input_tokens: 10,
										output_tokens: 20,
									},
								},
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20 })
		})

		it("createMessage should pass correct parameters to MiniMax client", async () => {
			const modelId: MinimaxModelId = "MiniMax-M2"
			const modelInfo = minimaxModels[modelId]
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: modelId,
				minimaxApiKey: "test-minimax-api-key",
			})

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			})

			const systemPrompt = "Test system prompt for MiniMax"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for MiniMax" }]

			const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: modelId,
					max_tokens: Math.min(modelInfo.maxTokens, Math.ceil(modelInfo.contextWindow * 0.2)),
					temperature: 1,
					system: expect.any(Array),
					messages: expect.any(Array),
					stream: true,
				}),
				{ signal: undefined },
			)
		})

		it("should use temperature 1 by default", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			})

			const messageGenerator = handler.createMessage("test", [])
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 1,
				}),
				{ signal: undefined },
			)
		})

		it("should handle thinking blocks in stream", async () => {
			const thinkingContent = "Let me think about this..."

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_start",
								index: 0,
								content_block: { type: "thinking", thinking: thinkingContent },
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "reasoning", text: thinkingContent })
		})

		it("should handle tool calls in stream", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_start",
								index: 0,
								content_block: {
									type: "tool_use",
									id: "tool-123",
									name: "get_weather",
									input: { city: "London" },
								},
							},
						})
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_stop",
								index: 0,
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			// Provider now yields tool_call_partial chunks, NativeToolCallParser handles reassembly
			expect(firstChunk.value).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "tool-123",
				name: "get_weather",
				arguments: undefined,
			})
		})
	})

	describe("Model Configuration", () => {
		it("should correctly configure MiniMax-M2 model properties", () => {
			const model = minimaxModels["MiniMax-M2"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(204_800)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.3)
			expect(model.outputPrice).toBe(1.2)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.03)
		})

		it("should correctly configure MiniMax-M2-Stable model properties", () => {
			const model = minimaxModels["MiniMax-M2-Stable"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(204_800)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.3)
			expect(model.outputPrice).toBe(1.2)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.03)
		})

		it("should correctly configure MiniMax-M2.7 model properties", () => {
			const model = minimaxModels["MiniMax-M2.7"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(204_800)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.3)
			expect(model.outputPrice).toBe(1.2)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.06)
		})

		it("should correctly configure MiniMax-M2.7-highspeed model properties", () => {
			const model = minimaxModels["MiniMax-M2.7-highspeed"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(204_800)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.6)
			expect(model.outputPrice).toBe(2.4)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.06)
		})

		it("should correctly configure MiniMax-M2.5-highspeed model properties", () => {
			const model = minimaxModels["MiniMax-M2.5-highspeed"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(204_800)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.6)
			expect(model.outputPrice).toBe(2.4)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.03)
		})

		it("should correctly configure MiniMax-M2.1-highspeed model properties", () => {
			const model = minimaxModels["MiniMax-M2.1-highspeed"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(204_800)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.6)
			expect(model.outputPrice).toBe(2.4)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.03)
		})

		it("should correctly configure MiniMax-M2.1 model properties with updated context window", () => {
			const model = minimaxModels["MiniMax-M2.1"]
			expect(model.contextWindow).toBe(204_800)
		})

		it("should correctly configure MiniMax-M2 model properties with updated context window", () => {
			const model = minimaxModels["MiniMax-M2"]
			expect(model.contextWindow).toBe(204_800)
		})
	})
})

// DEF-C9: MiniMax speaks the Anthropic streaming protocol, so message_delta
// carries the real, cumulative output token count and the reported cost must
// bill it.
describe("MiniMaxHandler cost accounting", () => {
	let handler: MiniMaxHandler
	let mockCreate: any

	const scriptedStream = (events: any[]) =>
		mockCreate.mockResolvedValueOnce({
			async *[Symbol.asyncIterator]() {
				for (const event of events) {
					yield event
				}
			},
		})

	const collectCostChunk = async () => {
		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}
		const costChunks = chunks.filter((chunk) => chunk.type === "usage" && chunk.totalCost !== undefined)
		expect(costChunks).toHaveLength(1)
		return costChunks[0]
	}

	const expectedCost = (inputTokens: number, outputTokens: number) => {
		const { inputPrice = 0, outputPrice = 0 } = handler.getModel().info
		expect(outputPrice).toBeGreaterThan(0)
		return (inputPrice * inputTokens + outputPrice * outputTokens) / 1_000_000
	}

	beforeEach(() => {
		vitest.clearAllMocks()
		mockCreate = (Anthropic as unknown as any)().messages.create
		handler = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
	})

	it("bills the output tokens reported in message_delta", async () => {
		scriptedStream([
			{ type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1 } } },
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "Hello" } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 500 } },
			{ type: "message_stop" },
		])

		const costChunk = await collectCostChunk()

		expect(costChunk.totalCost).toBeCloseTo(expectedCost(1000, 500), 12)
	})

	it("treats message_delta output tokens as cumulative and does not double count", async () => {
		scriptedStream([
			{ type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1 } } },
			{ type: "message_delta", delta: {}, usage: { output_tokens: 200 } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 500 } },
			{ type: "message_stop" },
		])

		const costChunk = await collectCostChunk()

		expect(costChunk.totalCost).toBeCloseTo(expectedCost(1000, 500), 12)
	})

	it("keeps the message_start output count when no message_delta arrives", async () => {
		scriptedStream([{ type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 7 } } }])

		const costChunk = await collectCostChunk()

		expect(costChunk.totalCost).toBeCloseTo(expectedCost(1000, 7), 12)
	})
})
