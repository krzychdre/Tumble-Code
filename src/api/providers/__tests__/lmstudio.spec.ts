// Mock OpenAI client - must come before other imports
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
										message: { role: "assistant", content: "Test response" },
										finish_reason: "stop",
										index: 0,
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
								},
							}
						}

						return {
							[Symbol.asyncIterator]: async function* () {
								yield {
									choices: [
										{
											delta: { content: "Test response" },
											index: 0,
										},
									],
									usage: null,
								}
								yield {
									choices: [
										{
											delta: {},
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
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

import type { Anthropic } from "@anthropic-ai/sdk"

import { LmStudioHandler } from "../lm-studio"
import type { ApiHandlerOptions } from "../../../shared/api"

describe("LmStudioHandler", () => {
	let handler: LmStudioHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			apiModelId: "local-model",
			lmStudioModelId: "local-model",
			lmStudioBaseUrl: "http://localhost:1234",
		}
		handler = new LmStudioHandler(mockOptions)
		mockCreate.mockClear()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(LmStudioHandler)
			expect(handler.getModel().id).toBe(mockOptions.lmStudioModelId)
		})

		it("should use default base URL if not provided", () => {
			const handlerWithoutUrl = new LmStudioHandler({
				apiModelId: "local-model",
				lmStudioModelId: "local-model",
			})
			expect(handlerWithoutUrl).toBeInstanceOf(LmStudioHandler)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
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

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))

			const stream = handler.createMessage(systemPrompt, messages)

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should not reach here
				}
			}).rejects.toThrow("Please check the LM Studio developer logs to debug what went wrong")
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith(
				{
					model: mockOptions.lmStudioModelId,
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
					stream: false,
				},
				expect.objectContaining({
					signal: expect.any(AbortSignal),
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"Please check the LM Studio developer logs to debug what went wrong",
			)
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "" } }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("streaming with choices-less SSE chunks", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello!" }]

		it("should not crash when first chunk has choices: undefined (keepalive)", async () => {
			mockCreate.mockImplementationOnce(async (options) => {
				if (!options.stream) return {}
				return {
					[Symbol.asyncIterator]: async function* () {
						// keepalive / usage-only chunk with no choices
						yield { choices: undefined, usage: null }
						// normal delta with content
						yield {
							choices: [{ delta: { content: "Hello back" }, index: 0 }],
							usage: null,
						}
						// final usage-only chunk with empty choices
						yield {
							choices: [],
							usage: { prompt_tokens: 1, completion_tokens: 2 },
						}
					},
				}
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Hello back")
		})

		it("should return empty string when completePrompt response has choices: []", async () => {
			mockCreate.mockResolvedValueOnce({ choices: [], usage: {} })
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("getModel", () => {
		it("should return model info", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(mockOptions.lmStudioModelId)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(-1)
			expect(modelInfo.info.contextWindow).toBe(128_000)
		})
	})

	describe("abort / cancelRequest", () => {
		it("should pass an AbortSignal as the second argument to chat.completions.create in createMessage", async () => {
			const stream = handler.createMessage("system prompt", [])
			await stream.next()

			expect(mockCreate).toHaveBeenCalledTimes(1)
			const secondArg = mockCreate.mock.calls[0][1]
			expect(secondArg).toBeDefined()
			expect(secondArg.signal).toBeInstanceOf(AbortSignal)
		})

		it("should pass an AbortSignal as the second argument to chat.completions.create in completePrompt", async () => {
			await handler.completePrompt("test prompt")

			expect(mockCreate).toHaveBeenCalledTimes(1)
			const secondArg = mockCreate.mock.calls[0][1]
			expect(secondArg).toBeDefined()
			expect(secondArg.signal).toBeInstanceOf(AbortSignal)
		})

		it("should abort the signal when cancelRequest() is called", async () => {
			// Mock a stream that yields one chunk then blocks
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: { choices: [{ delta: { content: "chunk1" } }] },
						})
						.mockImplementationOnce(() => new Promise(() => {})), // never resolves
				}),
			}))

			const stream = handler.createMessage("system prompt", [])
			const iterator = stream[Symbol.asyncIterator]()

			// Get first chunk
			const first = await iterator.next()
			expect(first.done).toBe(false)

			// Now cancel
			handler.cancelRequest()

			// The abort controller should be cleared
			expect((handler as any).abortController).toBeUndefined()
		})

		it("should create a fresh AbortController per request", async () => {
			const stream1 = handler.createMessage("system prompt", [])
			await stream1.next()
			const signal1 = mockCreate.mock.calls[0][1].signal as AbortSignal

			const stream2 = handler.createMessage("system prompt", [])
			await stream2.next()
			const signal2 = mockCreate.mock.calls[1][1].signal as AbortSignal

			expect(signal1).not.toBe(signal2)
		})

		it("should not destroy the client when cancelRequest(false)", async () => {
			handler.cancelRequest(false)
			expect((handler as any).client).toBeDefined()
		})

		it("should destroy the client when cancelRequest(true)", async () => {
			handler.cancelRequest(true)
			expect((handler as any).client).toBeNull()
		})
	})
})
