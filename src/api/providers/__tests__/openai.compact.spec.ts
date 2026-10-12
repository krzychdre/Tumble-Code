// npx vitest run api/providers/__tests__/openai.compact.spec.ts

import { type ApiHandlerOptions } from "@tumble-code/core/browser"
import { openAiModelInfoSaneDefaults } from "@tumble-code/types"

import { OpenAiHandler } from "../openai"
import { defaultOpenAiCreate } from "./provider-test-helpers"

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock("openai", async () => {
	const { openAiModuleMock } = await import("./provider-test-helpers")
	return openAiModuleMock(mockCreate)
})

/** A local llama.cpp profile: custom model info with the default maxTokens of -1 and a 40,960 window. */
const LOCAL: ApiHandlerOptions = {
	openAiBaseUrl: "http://127.0.0.1:8080/v1",
	openAiApiKey: "not-needed",
	openAiModelId: "qwen3.5-4b-q4_k_m",
	openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, maxTokens: -1, contextWindow: 40960 },
}

const tools = [
	{
		type: "function" as const,
		function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } },
	},
]

/** The body the handler hands to the SDK for one streamed request. */
async function sentBody(options: ApiHandlerOptions, metadata: Record<string, unknown> = {}) {
	mockCreate.mockClear()
	const handler = new OpenAiHandler(options)
	const stream = handler.createMessage("system prompt", [{ role: "user", content: "hello" }], {
		taskId: "t",
		tools,
		tool_choice: "auto",
		...metadata,
	})
	for await (const _chunk of stream) {
		// drain
	}
	expect(mockCreate).toHaveBeenCalledTimes(1)
	return mockCreate.mock.calls[0][0] as Record<string, unknown>
}

describe("OpenAiHandler under the compact profile", () => {
	beforeEach(() => {
		mockCreate.mockImplementation(defaultOpenAiCreate)
	})

	it("sends the compact output reservation as max_completion_tokens without includeMaxTokens", async () => {
		const body = await sentBody({ ...LOCAL, compactProfile: true })
		expect(body.max_completion_tokens).toBe(4096)
	})

	it("sends one tool call per message, whatever the caller asked", async () => {
		expect((await sentBody({ ...LOCAL, compactProfile: true })).parallel_tool_calls).toBe(false)
		expect(
			(await sentBody({ ...LOCAL, compactProfile: true }, { parallelToolCalls: true })).parallel_tool_calls,
		).toBe(false)
	})

	it("keeps a smaller explicit max tokens and lowers a larger one to the reservation", async () => {
		const smaller = await sentBody({ ...LOCAL, compactProfile: true, includeMaxTokens: true, modelMaxTokens: 1000 })
		expect(smaller.max_completion_tokens).toBe(1000)

		const larger = await sentBody({ ...LOCAL, compactProfile: true, includeMaxTokens: true, modelMaxTokens: 30000 })
		expect(larger.max_completion_tokens).toBe(4096)
	})

	it("keeps today's 20 percent clamp for a positive model maxTokens", async () => {
		const body = await sentBody({
			...LOCAL,
			compactProfile: true,
			openAiCustomModelInfo: { ...LOCAL.openAiCustomModelInfo!, maxTokens: 16384 },
		})
		expect(body.max_completion_tokens).toBe(8192)
	})

	it("bounds the non-streaming request and completePrompt too", async () => {
		await sentBody({ ...LOCAL, compactProfile: true, openAiStreamingEnabled: false })
		expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBe(4096)
		expect(mockCreate.mock.calls[0][0].parallel_tool_calls).toBe(false)

		mockCreate.mockClear()
		await new OpenAiHandler({ ...LOCAL, compactProfile: true }).completePrompt("hi")
		expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBe(4096)
	})

	describe("flag off: today's request parameters", () => {
		for (const [label, flag] of [
			["absent", {}],
			["false", { compactProfile: false }],
		] as const) {
			it(`with the flag ${label}`, async () => {
				const body = await sentBody({ ...LOCAL, ...flag })
				expect(body).not.toHaveProperty("max_completion_tokens")
				expect(body.parallel_tool_calls).toBe(true)

				// includeMaxTokens sends the model's raw value, -1 included, as before.
				const withMax = await sentBody({ ...LOCAL, ...flag, includeMaxTokens: true })
				expect(withMax.max_completion_tokens).toBe(-1)

				expect((await sentBody({ ...LOCAL, ...flag }, { parallelToolCalls: false })).parallel_tool_calls).toBe(
					false,
				)
			})
		}
	})
})
