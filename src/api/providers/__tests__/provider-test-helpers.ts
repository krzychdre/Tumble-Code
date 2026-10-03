/**
 * Shared SDK-mock scaffold for the provider specs (R3-7, round-3 audit item 7).
 *
 * Almost every OpenAI-protocol spec mocks the "openai" module with the same
 * shape - a constructor handing back a client whose chat.completions.create is
 * the spec's `mockCreate` - and the Anthropic-protocol specs do the same with
 * messages.create. The canonical default implementation answers "Test
 * response" with the 10/5/15 usage triple (10/5 on the Anthropic protocol).
 *
 * Usage (vitest hoists vi.mock above every import, so the mock fn must come
 * from vi.hoisted and the helper from a dynamic import inside the factory):
 *
 *   const mockCreate = vi.hoisted(() => vi.fn())
 *   vi.mock("openai", async () => {
 *     const { openAiModuleMock } = await import("./provider-test-helpers")
 *     return openAiModuleMock(mockCreate)
 *   })
 *   // default impl, when the spec wants one, in the factory:
 *   //   return openAiModuleMock(mockCreate.mockImplementation(defaultOpenAiCreate))
 *   // or re-set it in beforeEach after vi.clearAllMocks().
 *
 * Specs with bespoke fixtures keep them inline (deepseek's cache-split usage,
 * openai-usage-tracking's evolving-usage stream, mistral's own protocol); do
 * not bend a test's assertions to fit the canonical builders.
 */

export const TEST_RESPONSE_TEXT = "Test response"

/** The canonical usage triple the OpenAI-protocol mocks answer with. */
export const OPENAI_TEST_USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } as const

/** The canonical usage pair the Anthropic-protocol mocks answer with. */
export const ANTHROPIC_TEST_USAGE = { input_tokens: 10, output_tokens: 5 } as const

// --- OpenAI protocol (openai, lm-studio, lite-llm, qwen-code, ...) ---

/** Canonical non-streaming completion: "Test response", usage 10/5/15. */
export const openAiCompletionResponse = () => ({
	id: "test-completion",
	choices: [
		{
			message: { role: "assistant", content: TEST_RESPONSE_TEXT, refusal: null },
			finish_reason: "stop",
			index: 0,
		},
	],
	usage: { ...OPENAI_TEST_USAGE },
})

/** Canonical streaming completion: one text delta, usage in the final chunk. */
export const openAiStreamResponse = () => ({
	[Symbol.asyncIterator]: async function* () {
		yield { choices: [{ delta: { content: TEST_RESPONSE_TEXT }, index: 0 }], usage: null }
		yield { choices: [{ delta: {}, index: 0 }], usage: { ...OPENAI_TEST_USAGE } }
	},
})

/** Default chat.completions.create implementation answering in both modes. */
export const defaultOpenAiCreate = async (options: { stream?: boolean }) =>
	options.stream ? openAiStreamResponse() : openAiCompletionResponse()

/** The client object the mocked OpenAI SDK constructor returns. */
export const openAiClient = (create: unknown) => ({
	chat: {
		completions: {
			create,
		},
	},
})

/**
 * Body of `vi.mock("openai", () => ...)`: __esModule + default constructor.
 * `extraClientFields` covers specs whose handler reads fields off the client
 * itself (qwen-code: apiKey/baseURL).
 */
export const openAiModuleMock = (create: unknown, extraClientFields: Record<string, unknown> = {}) => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { ...extraClientFields, ...openAiClient(create) }
	}),
})

// --- Anthropic protocol (anthropic, minimax, vertex, ...) ---

/** Canonical non-streaming message: "Test response", usage 10/5. */
export const anthropicMessageResponse = (model?: string) => ({
	id: "test-completion",
	content: [{ type: "text", text: TEST_RESPONSE_TEXT }],
	role: "assistant",
	model,
	usage: { ...ANTHROPIC_TEST_USAGE },
})

/** Canonical streaming message: message_start (10/5), then one text block. */
export const anthropicStreamResponse = () => ({
	async *[Symbol.asyncIterator]() {
		yield {
			type: "message_start",
			message: { usage: { ...ANTHROPIC_TEST_USAGE } },
		}
		yield {
			type: "content_block_start",
			content_block: { type: "text", text: TEST_RESPONSE_TEXT },
		}
	},
})

/** Default messages.create implementation answering in both modes. */
export const defaultAnthropicCreate = async (options: { stream?: boolean; model?: string }) =>
	options.stream ? anthropicStreamResponse() : anthropicMessageResponse(options.model)

/** The client object the mocked Anthropic SDK constructor returns. */
export const anthropicClient = (create: unknown) => ({
	messages: {
		create,
	},
})

/** Body of `vi.mock("@anthropic-ai/sdk", () => ...)`. */
export const anthropicModuleMock = (create: unknown) => ({
	Anthropic: vi.fn().mockImplementation(function () {
		return anthropicClient(create)
	}),
})

/** Body of `vi.mock("@anthropic-ai/vertex-sdk", () => ...)`. */
export const anthropicVertexModuleMock = (create: unknown) => ({
	AnthropicVertex: vi.fn().mockImplementation(function () {
		return anthropicClient(create)
	}),
})

/** Body of `vi.mock("@mistralai/mistralai", () => ...)`: chat.stream + chat.complete. */
export const mistralModuleMock = (stream: unknown, complete: unknown) => ({
	Mistral: vi.fn().mockImplementation(function () {
		return {
			chat: {
				stream,
				complete,
			},
		}
	}),
})
