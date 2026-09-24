// npx vitest run api/providers/__tests__/openai-usage-tracking.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ApiHandlerOptions } from "../../../shared/api"
import { OpenAiHandler } from "../openai"

const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation(() => ({
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
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
								},
							}
						}

						// Return a stream with multiple chunks that include usage metrics
						return {
							[Symbol.asyncIterator]: async function* () {
								// First chunk with partial usage
								yield {
									choices: [
										{
											delta: { content: "Test " },
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 2,
										total_tokens: 12,
									},
								}

								// Second chunk with updated usage
								yield {
									choices: [
										{
											delta: { content: "response" },
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 4,
										total_tokens: 14,
									},
								}

								// Final chunk with complete usage
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

describe("OpenAiHandler with usage tracking fix", () => {
	let handler: OpenAiHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			openAiApiKey: "test-api-key",
			openAiModelId: "gpt-4",
			openAiBaseUrl: "https://api.openai.com/v1",
		}
		handler = new OpenAiHandler(mockOptions)
		mockCreate.mockClear()
	})

	describe("usage metrics with streaming", () => {
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

		it("should only yield usage metrics once at the end of the stream", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Check we have text chunks
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Test ")
			expect(textChunks[1].text).toBe("response")

			// Check we only have one usage chunk and it's the last one
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
			})

			// Check the usage chunk is the last one reported from the API
			const lastChunk = chunks[chunks.length - 1]
			expect(lastChunk.type).toBe("usage")
			expect(lastChunk.inputTokens).toBe(10)
			expect(lastChunk.outputTokens).toBe(5)
		})

		it("should handle case where usage is only in the final chunk", async () => {
			// Override the mock for this specific test
			mockCreate.mockImplementationOnce(async (options) => {
				if (!options.stream) {
					return {
						id: "test-completion",
						choices: [{ message: { role: "assistant", content: "Test response" } }],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}
				}

				return {
					[Symbol.asyncIterator]: async function* () {
						// First chunk with no usage
						yield {
							choices: [{ delta: { content: "Test " }, index: 0 }],
							usage: null,
						}

						// Second chunk with no usage
						yield {
							choices: [{ delta: { content: "response" }, index: 0 }],
							usage: null,
						}

						// Final chunk with usage data
						yield {
							choices: [{ delta: {}, index: 0 }],
							usage: {
								prompt_tokens: 10,
								completion_tokens: 5,
								total_tokens: 15,
							},
						}
					},
				}
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Check usage metrics
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
			})
		})

		it("should handle case where no usage is provided", async () => {
			// Override the mock for this specific test
			mockCreate.mockImplementationOnce(async (options) => {
				if (!options.stream) {
					return {
						id: "test-completion",
						choices: [{ message: { role: "assistant", content: "Test response" } }],
						usage: null,
					}
				}

				return {
					[Symbol.asyncIterator]: async function* () {
						yield {
							choices: [{ delta: { content: "Test response" }, index: 0 }],
							usage: null,
						}
						yield {
							choices: [{ delta: {}, index: 0 }],
							usage: null,
						}
					},
				}
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Check we don't have any usage chunks
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(0)
		})
	})

	// DEF-C12: the O3 family path (handleStreamResponse) used to yield one
	// usage chunk per stream chunk. TaskStreamProcessor adds usage chunks
	// together, so a server that repeats its cumulative usage in every chunk
	// (the default mock above: 2, 4, then 5 completion tokens) was billed
	// 10 + 10 + 10 input and 2 + 4 + 5 output tokens instead of 10 and 5.
	describe("usage metrics with streaming on the O3 family path", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello!" }]

		let o3Handler: OpenAiHandler

		beforeEach(() => {
			o3Handler = new OpenAiHandler({ ...mockOptions, openAiModelId: "o3-mini" })
		})

		it("reports cumulative usage repeated in every chunk once, with the final values", async () => {
			const chunks: any[] = []
			for await (const chunk of o3Handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			// The request really went through the streaming O3 path.
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({ model: "o3-mini", stream: true }),
				expect.anything(),
			)

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toEqual([{ type: "usage", inputTokens: 10, outputTokens: 5 }])
			expect(chunks[chunks.length - 1].type).toBe("usage")
		})

		it("yields no usage chunk when the stream carries no usage", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { choices: [{ delta: { content: "Test response" }, index: 0 }], usage: null }
					yield { choices: [{ delta: {}, index: 0 }], usage: null }
				},
			}))

			const chunks: any[] = []
			for await (const chunk of o3Handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			expect(chunks.filter((chunk) => chunk.type === "usage")).toHaveLength(0)
		})
	})
})
