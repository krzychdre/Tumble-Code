// Mocks must come first, before imports
const mockCreate = vi.fn()
vi.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
								id: "test-completion",
								choices: [
									{
										message: { role: "assistant", content: "Test response", refusal: null },
										finish_reason: "stop",
										index: 0,
									},
								],
								// DeepSeek's documented usage shape: the cache split is
								// top-level (hit + miss = prompt_tokens), with the hit
								// count mirrored in prompt_tokens_details.cached_tokens.
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
									prompt_tokens_details: {
										cached_tokens: 2,
									},
									prompt_cache_hit_tokens: 2,
									prompt_cache_miss_tokens: 8,
								},
							}
						}

						// Check if this is a reasoning_content test by looking at thinking mode
						const isThinkingModel = options.thinking?.type === "enabled"
						const isToolCallTest = options.tools?.length > 0

						// Return async iterator for streaming
						return {
							[Symbol.asyncIterator]: async function* () {
								// For thinking models, emit reasoning_content first
								if (isThinkingModel) {
									yield {
										choices: [
											{
												delta: { reasoning_content: "Let me think about this..." },
												index: 0,
											},
										],
										usage: null,
									}
									yield {
										choices: [
											{
												delta: { reasoning_content: " I'll analyze step by step." },
												index: 0,
											},
										],
										usage: null,
									}
								}

								// For tool call tests with thinking mode, emit tool call
								if (isThinkingModel && isToolCallTest) {
									yield {
										choices: [
											{
												delta: {
													tool_calls: [
														{
															index: 0,
															id: "call_123",
															function: {
																name: "get_weather",
																arguments: '{"location":"SF"}',
															},
														},
													],
												},
												index: 0,
											},
										],
										usage: null,
									}
								} else {
									yield {
										choices: [
											{
												delta: { content: "Test response" },
												index: 0,
											},
										],
										usage: null,
									}
								}

								yield {
									choices: [
										{
											delta: {},
											index: 0,
											finish_reason: isToolCallTest ? "tool_calls" : "stop",
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
										prompt_tokens_details: {
											cached_tokens: 2,
										},
										prompt_cache_hit_tokens: 2,
										prompt_cache_miss_tokens: 8,
									},
								}
							},
						}
					}),
				},
			},
		})),
	}
})

import OpenAI from "openai"
import type { Anthropic } from "@anthropic-ai/sdk"

import { deepSeekDefaultModelId, deepSeekModels, DEEP_SEEK_DEFAULT_TEMPERATURE, type ModelInfo } from "@roo-code/types"

import { calculateApiCostOpenAI } from "../../../shared/cost"

import type { ApiHandlerOptions } from "../../../shared/api"

import { DeepSeekHandler } from "../deepseek"

describe("DeepSeekHandler", () => {
	let handler: DeepSeekHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			deepSeekApiKey: "test-api-key",
			apiModelId: "deepseek-flash",
			deepSeekBaseUrl: "https://api.deepseek.com",
		}
		handler = new DeepSeekHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(DeepSeekHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it.skip("should throw error if API key is missing", () => {
			expect(() => {
				new DeepSeekHandler({
					...mockOptions,
					deepSeekApiKey: undefined,
				})
			}).toThrow("DeepSeek API key is required")
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(deepSeekDefaultModelId)
		})

		it("should use default base URL if not provided", () => {
			const handlerWithoutBaseUrl = new DeepSeekHandler({
				...mockOptions,
				deepSeekBaseUrl: undefined,
			})
			expect(handlerWithoutBaseUrl).toBeInstanceOf(DeepSeekHandler)
			// Trigger lazy client initialization (getClient is protected, so cast to any)
			;(handlerWithoutBaseUrl as any).getClient()
			// The base URL is passed to OpenAI client internally
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.deepseek.com",
				}),
			)
		})

		it("should use custom base URL if provided", () => {
			const customBaseUrl = "https://custom.deepseek.com/v1"
			const handlerWithCustomUrl = new DeepSeekHandler({
				...mockOptions,
				deepSeekBaseUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(DeepSeekHandler)
			// Trigger lazy client initialization (getClient is protected, so cast to any)
			;(handlerWithCustomUrl as any).getClient()
			// The custom base URL is passed to OpenAI client
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: customBaseUrl,
				}),
			)
		})

		it("should set includeMaxTokens to true", () => {
			// Create a new handler and verify OpenAI client was called with includeMaxTokens
			const _handler = new DeepSeekHandler(mockOptions)
			// Trigger lazy client initialization (getClient is protected, so cast to any)
			;(_handler as any).getClient()
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: mockOptions.deepSeekApiKey }))
		})
	})

	describe("getModel", () => {
		it("should return model info for valid model ID", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(393_216)
			expect(model.info.contextWindow).toBe(1_048_576)
			// DeepSeek-V4.1-Flash is natively multimodal.
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should use deepseek-flash as the default model ID for new configs", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(deepSeekDefaultModelId)
			expect(model.id).toBe("deepseek-flash")
			expect(model.info.maxTokens).toBe(393_216)
			expect(model.info.contextWindow).toBe(1_048_576)
			expect((model.info as ModelInfo).supportsReasoningEffort).toContain("xhigh")
		})

		it("should return correct model info for deepseek-v4-pro", () => {
			const handlerWithV4Pro = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
			})
			const model = handlerWithV4Pro.getModel()
			expect(model.id).toBe("deepseek-v4-pro")
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(393_216)
			expect(model.info.contextWindow).toBe(1_048_576)
			expect(model.info.supportsPromptCache).toBe(true)
			expect((model.info as ModelInfo).preserveReasoning).toBe(true)
			expect((model.info as ModelInfo).reasoningEffort).toBe("high")
		})

		it("should return correct model info for deepseek-v4-pro", () => {
			const handlerWithPro = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
			})
			const model = handlerWithPro.getModel()
			expect(model.id).toBe("deepseek-v4-pro")
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(393_216)
			expect(model.info.contextWindow).toBe(1_048_576)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		// DeepSeek retired V4 Flash and V4 Flash Vision Exp on 2026-09-10; both
		// names are still accepted and served by DeepSeek-V4.1-Flash.
		it.each(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
			"should keep the legacy name %s as sent, described by deepseek-flash",
			(legacyId) => {
				const model = new DeepSeekHandler({ ...mockOptions, apiModelId: legacyId }).getModel()
				expect(model.id).toBe(legacyId)
				expect(model.info).toEqual(deepSeekModels["deepseek-flash"])
				expect(model.info.supportsImages).toBe(true)
			},
		)

		it.each(["deepseek-chat", "deepseek-reasoner"])(
			"should keep the retired name %s as sent, flagged deprecated",
			(legacyId) => {
				const model = new DeepSeekHandler({ ...mockOptions, apiModelId: legacyId }).getModel()
				expect(model.id).toBe(legacyId)
				expect(model.info.deprecated).toBe(true)
			},
		)

		it("should have preserveReasoning enabled on the V4 models to support interleaved thinking", () => {
			// This is critical for DeepSeek's interleaved thinking mode with tool calls.
			// See: https://api-docs.deepseek.com/guides/thinking_mode
			// The reasoning_content needs to be passed back during tool call continuation
			// within the same turn for the model to continue reasoning properly.
			const model = handler.getModel()
			// Cast to ModelInfo to access preserveReasoning which is an optional property
			expect((model.info as ModelInfo).preserveReasoning).toBe(true)
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const defaultHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model") // Returns provided ID
			expect(model.info).toBeDefined()
			// With the current implementation, it's the same object reference when using default model info
			expect(model.info).toBe(defaultHandler.getModel().info)
			// Should have the same base properties
			expect(model.info.contextWindow).toBe(defaultHandler.getModel().info.contextWindow)
			// And should have supportsPromptCache set to true
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(deepSeekDefaultModelId)
			expect(model.info).toBeDefined()
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should include model parameters from getModelParams", () => {
			const model = handler.getModel()
			expect(model).toHaveProperty("temperature")
			expect(model).toHaveProperty("maxTokens")
		})

		it("should use DEEP_SEEK_DEFAULT_TEMPERATURE as the default temperature", () => {
			const model = handler.getModel()
			expect(model.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
		})

		it("should respect user-provided temperature over DEEP_SEEK_DEFAULT_TEMPERATURE", () => {
			const handlerWithTemp = new DeepSeekHandler({
				...mockOptions,
				modelTemperature: 0.9,
			})
			const model = handlerWithTemp.getModel()
			expect(model.temperature).toBe(0.9)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello!",
					},
				],
			},
		]

		it("should handle streaming responses", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response")
		})

		it("should include usage information", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].inputTokens).toBe(10)
			expect(usageChunks[0].outputTokens).toBe(5)
		})

		it("should include cache metrics in usage information", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			// DeepSeek has no cache writes: the 8 missed tokens are ordinary input.
			expect(usageChunks[0].cacheWriteTokens).toBeUndefined()
			expect(usageChunks[0].cacheReadTokens).toBe(2)
		})

		it("streams reasoning chunks from delta.reasoning_content", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { choices: [{ delta: { reasoning_content: "thinking..." }, index: 0 }] }
					yield { choices: [{ delta: { content: "answer" }, index: 0 }] }
					yield {
						choices: [{ delta: {}, index: 0 }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}
				},
			}))

			const chunks: any[] = []
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			expect(chunks).toContainEqual({ type: "reasoning", text: "thinking..." })
		})

		it("yields reasoning before text when one delta carries both", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { choices: [{ delta: { reasoning_content: "thinking...", content: "answer" }, index: 0 }] }
					yield {
						choices: [{ delta: {}, index: 0 }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}
				},
			}))

			const chunks: any[] = []
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			expect(chunks.filter((c) => c.type === "reasoning" || c.type === "text")).toEqual([
				{ type: "reasoning", text: "thinking..." },
				{ type: "text", text: "answer" },
			])
		})

		it("falls back to delta.reasoning when reasoning_content is absent", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { choices: [{ delta: { reasoning: "router-style thought" }, index: 0 }] }
					yield {
						choices: [{ delta: {}, index: 0 }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}
				},
			}))

			const chunks: any[] = []
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			expect(chunks).toContainEqual({ type: "reasoning", text: "router-style thought" })
		})

		it("prefers delta.reasoning_content over delta.reasoning when both are present", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									reasoning_content: "primary thought",
									reasoning: "fallback thought",
								},
								index: 0,
							},
						],
					}
					yield {
						choices: [{ delta: {}, index: 0 }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}
				},
			}))

			const chunks: any[] = []
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks).toEqual([{ type: "reasoning", text: "primary thought" }])
		})
	})

	describe("processUsageMetrics", () => {
		class TestDeepSeekHandler extends DeepSeekHandler {
			public testProcessUsageMetrics(usage: any) {
				return this.processUsageMetrics(usage)
			}
		}

		// https://api-docs.deepseek.com/api/create-chat-completion: prompt_tokens
		// equals prompt_cache_hit_tokens + prompt_cache_miss_tokens (both required,
		// top level); prompt_tokens_details.cached_tokens is optional and "same as
		// prompt_cache_hit_tokens". DeepSeek has no cache writes.
		const documentedUsage = {
			prompt_tokens: 100,
			completion_tokens: 50,
			total_tokens: 150,
			prompt_tokens_details: { cached_tokens: 20 },
			prompt_cache_hit_tokens: 20,
			prompt_cache_miss_tokens: 80,
		}

		it("reads the documented cache hit count and reports no cache writes", () => {
			const result = new TestDeepSeekHandler(mockOptions).testProcessUsageMetrics(documentedUsage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheReadTokens).toBe(20)
			expect(result.cacheWriteTokens).toBeUndefined()
		})

		it("reads the top-level prompt_cache_hit_tokens when prompt_tokens_details carries no cached_tokens", () => {
			// cached_tokens is optional in DeepSeek's schema; prompt_cache_hit_tokens is required.
			const { prompt_tokens_details: _details, ...usage } = documentedUsage

			const result = new TestDeepSeekHandler(mockOptions).testProcessUsageMetrics(usage)

			expect(result.cacheReadTokens).toBe(20)
			expect(result.cacheWriteTokens).toBeUndefined()
		})

		it("never reports cache misses as cache writes", () => {
			// The shape the handler used to assume. A miss is billed as ordinary input.
			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				prompt_tokens_details: { cache_miss_tokens: 80, cached_tokens: 20 },
			}

			const result = new TestDeepSeekHandler(mockOptions).testProcessUsageMetrics(usage)

			expect(result.cacheWriteTokens).toBeUndefined()
			expect(result.cacheReadTokens).toBe(20)
		})

		it("prices hits at the cache read price and misses at the input price", () => {
			const { prompt_tokens_details: _details, ...usage } = documentedUsage
			const info = deepSeekModels[deepSeekDefaultModelId] as ModelInfo
			const result = new TestDeepSeekHandler(mockOptions).testProcessUsageMetrics(usage)

			const { totalCost } = calculateApiCostOpenAI(
				info,
				result.inputTokens,
				result.outputTokens,
				result.cacheWriteTokens,
				result.cacheReadTokens,
			)

			const expected =
				(20 * info.cacheReadsPrice! + 80 * info.inputPrice! + 50 * info.outputPrice!) / 1_000_000
			expect(totalCost).toBeCloseTo(expected, 12)
		})

		it("should handle missing cache metrics gracefully", () => {
			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				// No prompt_tokens_details
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBeUndefined()
			expect(result.cacheReadTokens).toBeUndefined()
		})
	})

	describe("interleaved thinking mode", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello!",
					},
				],
			},
		]

		it("should handle reasoning_content in streaming responses for thinking models", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
			})

			const stream = reasonerHandler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have reasoning chunks
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks.length).toBeGreaterThan(0)
			expect(reasoningChunks[0].text).toBe("Let me think about this...")
			expect(reasoningChunks[1].text).toBe(" I'll analyze step by step.")
		})

		it("should pass thinking parameter for deepseek-v4-pro model", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
			})

			const stream = reasonerHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			// Verify that the thinking parameter was passed to the API
			// Note: mockCreate receives two arguments - request options and path options
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					thinking: { type: "enabled" },
				}),
				{ signal: expect.any(AbortSignal) }, // No path option for non-Azure URLs
			)
		})

		it("should send thinking disabled and omit reasoning_effort when reasoning is turned off", async () => {
			const chatHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-flash",
				enableReasoningEffort: false,
			})

			const stream = chatHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			// V4 models always carry an explicit thinking field; turning reasoning off
			// flips it to "disabled" rather than dropping it, and drops the effort.
			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.thinking).toEqual({ type: "disabled" })
			expect(callArgs.reasoning_effort).toBeUndefined()
		})

		// The thinking toggle is keyed on model ids: the current names and the
		// legacy Flash names DeepSeek still serves (with V4.1 Flash) all get it.
		it.each(["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
			"should enable thinking by default for %s",
			async (modelId) => {
				const v4Handler = new DeepSeekHandler({
					...mockOptions,
					apiModelId: modelId,
				})

				const stream = v4Handler.createMessage(systemPrompt, messages)
				for await (const _chunk of stream) {
					// Consume the stream
				}

				expect(mockCreate).toHaveBeenCalledWith(
					expect.objectContaining({
						model: modelId,
						thinking: { type: "enabled" },
						reasoning_effort: "high",
						// 20% of the 1_048_576-token context window.
						max_completion_tokens: 209_716,
					}),
					{ signal: expect.any(AbortSignal) },
				)
				expect(mockCreate.mock.calls[0][0].temperature).toBeUndefined()
			},
		)

		it.each(["deepseek-flash", "deepseek-v4-flash"])(
			"should send thinking disabled for %s when reasoning is turned off",
			async (modelId) => {
				const v4Handler = new DeepSeekHandler({
					...mockOptions,
					apiModelId: modelId,
					reasoningEffort: "disable",
				})

				const stream = v4Handler.createMessage(systemPrompt, messages)
				for await (const _chunk of stream) {
					// Consume the stream
				}

				const callArgs = mockCreate.mock.calls[0][0]
				expect(callArgs.thinking).toEqual({ type: "disabled" })
				expect(callArgs.reasoning_effort).toBeUndefined()
				expect(callArgs.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
			},
		)

		// Since 2026-08-13 DeepSeek accepts low / high / max (thinking mode
		// guide): low is a level of its own, no longer folded into high.
		it.each([
			["low", "low"],
			["medium", "high"],
			["high", "high"],
			["xhigh", "max"],
		] as const)("should send reasoning effort %s as %s", async (setting, sent) => {
			const v4Handler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-flash",
				reasoningEffort: setting,
			})

			const stream = v4Handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			expect(mockCreate.mock.calls[0][0].reasoning_effort).toBe(sent)
		})

		// The retired names: deepseek-reasoner was the thinking mode and keeps
		// thinking on (a compatible endpoint may still serve it); deepseek-chat
		// was the non-thinking mode and gets no thinking fields.
		it("should enable thinking for the retired deepseek-reasoner name", async () => {
			const legacyHandler = new DeepSeekHandler({ ...mockOptions, apiModelId: "deepseek-reasoner" })

			const stream = legacyHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.model).toBe("deepseek-reasoner")
			expect(callArgs.thinking).toEqual({ type: "enabled" })
		})

		it("should send no thinking fields for the retired deepseek-chat name", async () => {
			const legacyHandler = new DeepSeekHandler({ ...mockOptions, apiModelId: "deepseek-chat" })

			const stream = legacyHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.model).toBe("deepseek-chat")
			expect(callArgs.thinking).toBeUndefined()
			expect(callArgs.reasoning_effort).toBeUndefined()
			expect(callArgs.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
		})

		it("should respect user max token override for deepseek-v4 models", async () => {
			const v4Handler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-flash",
				modelMaxTokens: 32_000,
			})

			const stream = v4Handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_completion_tokens).toBe(32_000)
		})

		it("should map xhigh reasoning effort to DeepSeek max effort", async () => {
			const v4Handler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
				reasoningEffort: "xhigh",
			})

			const stream = v4Handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					thinking: { type: "enabled" },
					reasoning_effort: "max",
				}),
				{ signal: expect.any(AbortSignal) },
			)
		})

		it("should disable thinking for deepseek-v4 models when reasoning is disabled", async () => {
			const v4Handler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
				enableReasoningEffort: false,
			})

			const stream = v4Handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.thinking).toEqual({ type: "disabled" })
			expect(callArgs.reasoning_effort).toBeUndefined()
		})

		it("should not send V4 thinking parameters for unknown model IDs", async () => {
			const customHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "custom-deepseek-model",
			})

			const stream = customHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.thinking).toBeUndefined()
			expect(callArgs.reasoning_effort).toBeUndefined()
			expect(callArgs.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
		})

		it("should handle tool calls with reasoning_content", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-pro",
			})

			const tools: any[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const stream = reasonerHandler.createMessage(systemPrompt, messages, { taskId: "test", tools })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have reasoning chunks
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks.length).toBeGreaterThan(0)

			// Should have tool call chunks
			const toolCallChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			expect(toolCallChunks.length).toBeGreaterThan(0)
			expect(toolCallChunks[0].name).toBe("get_weather")
		})
	})

	describe("finish_reason chunk handling (AP-6)", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello!",
					},
				],
			},
		]

		it("should yield finish_reason chunk when finish_reason is 'stop' after tool_calls deltas (AP-6)", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_deepseek_ap6",
											function: {
												name: "get_weather",
												arguments: '{"location":"SF"}',
											},
										},
									],
								},
								index: 0,
							},
						],
					}
					yield {
						choices: [
							{
								delta: {},
								index: 0,
								finish_reason: "stop",
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}
				},
			}))

			const chatHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-flash",
			})

			const tools: any[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const stream = chatHandler.createMessage(systemPrompt, messages, { taskId: "test", tools })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// AP-6: DeepSeek has its own stream loop and must yield finish_reason chunks
			const partialChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			const finishReasonChunks = chunks.filter((chunk) => chunk.type === "finish_reason")

			expect(partialChunks).toHaveLength(1)
			expect(finishReasonChunks).toHaveLength(1)
			expect(finishReasonChunks[0]).toEqual({ type: "finish_reason", finishReason: "stop" })
		})

		it("should yield finish_reason chunk when finish_reason is 'tool_calls' (AP-6)", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_deepseek_tc",
											function: {
												name: "get_weather",
												arguments: '{"location":"SF"}',
											},
										},
									],
								},
								index: 0,
							},
						],
					}
					yield {
						choices: [
							{
								delta: {},
								index: 0,
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}
				},
			}))

			const chatHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-flash",
			})

			const tools: any[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const stream = chatHandler.createMessage(systemPrompt, messages, { taskId: "test", tools })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const finishReasonChunks = chunks.filter((chunk) => chunk.type === "finish_reason")
			expect(finishReasonChunks).toHaveLength(1)
			expect(finishReasonChunks[0]).toEqual({ type: "finish_reason", finishReason: "tool_calls" })
		})
	})
})
