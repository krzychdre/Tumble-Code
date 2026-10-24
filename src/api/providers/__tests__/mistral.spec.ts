// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/mistral.spec.ts
// The request, the endpoint choice, the stream mapping, the errors and the abort signal are
// pinned against the real @mistralai/mistralai client by mistral-wire-characterization. This
// spec covers the remaining branches of MistralHandler with the SDK client replaced.

const mocks = vi.hoisted(() => ({ stream: vi.fn(), complete: vi.fn(), captureException: vi.fn() }))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: mocks.captureException } },
}))
vi.mock("@mistralai/mistralai", async () => {
	const { mistralModuleMock } = await import("./provider-test-helpers")
	return mistralModuleMock(mocks.stream, mocks.complete)
})

import type OpenAI from "openai"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { MISTRAL_DEFAULT_TEMPERATURE, mistralDefaultModelId, mistralModels } from "@tumble-code/types"

import { MistralHandler } from "../mistral"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new MistralHandler({ mistralApiKey: "test-api-key", apiModelId: "mistral-large-latest", ...options })
}

function events(...data: unknown[]) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of data) {
				yield { data: item }
			}
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

beforeEach(() => {
	vi.clearAllMocks()
	mocks.stream.mockResolvedValue(events())
})

it("requires an API key", () => {
	expect(() => new MistralHandler({ apiModelId: "mistral-large-latest" })).toThrow("Mistral API key is required")
})

describe("request", () => {
	// The model's max tokens goes out with includeMaxTokens off as well (`maxTokens ?? info.maxTokens`).
	it.each([
		[
			"the default model with its default temperature",
			{ apiModelId: undefined },
			mistralDefaultModelId,
			MISTRAL_DEFAULT_TEMPERATURE,
		],
		["the user's temperature", { includeMaxTokens: true, modelTemperature: 0.7 }, "mistral-large-latest", 0.7],
	])("sends %s and the model's max tokens", async (_label, options, model, temperature) => {
		await drain(handlerFor(options).createMessage("System", []))
		expect(mocks.stream.mock.calls[0][0]).toMatchObject({
			model,
			temperature,
			maxTokens: mistralModels[model as keyof typeof mistralModels].maxTokens,
		})
	})

	it("converts the function tools, with empty parameters when a tool has none, and requires a tool", async () => {
		const tools = [
			{ type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object" } } },
			{ type: "function", function: { name: "attempt_completion" } },
			{ type: "custom", custom: { name: "ignored" } },
		] as OpenAI.Chat.ChatCompletionTool[]
		await drain(handlerFor().createMessage("System", [], { taskId: "t", tools }))
		const request = mocks.stream.mock.calls[0][0]
		expect(request.tools).toEqual([
			{ type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object" } } },
			{ type: "function", function: { name: "attempt_completion", description: undefined, parameters: {} } },
		])
		expect(request.toolChoice).toBe("any")
	})
})

describe("stream", () => {
	it("numbers several tool calls of one event", async () => {
		mocks.stream.mockResolvedValueOnce(
			events({
				choices: [
					{
						delta: {
							toolCalls: [
								{ id: "a", function: { name: "read_file", arguments: "{}" } },
								{ id: "b", function: { name: "list_files", arguments: "{}" } },
							],
						},
					},
				],
			}),
		)
		const chunks = await drain(handlerFor().createMessage("s", []))
		expect(chunks.map((chunk) => [chunk.index, chunk.id])).toEqual([
			[0, "a"],
			[1, "b"],
		])
	})

	// Servers repeat the cumulative usage in every event and usage chunks are added together,
	// so only the last one is reported (DEF-C12).
	it("reports the last usage once, and none without usage", async () => {
		mocks.stream.mockResolvedValueOnce(
			events(
				{ choices: [{ delta: { content: "a" } }], usage: { promptTokens: 10, completionTokens: 1 } },
				{ choices: [{ delta: { content: "b" } }], usage: { promptTokens: 10, completionTokens: 5 } },
				{ choices: [] },
			),
		)
		const chunks = await drain(handlerFor().createMessage("s", []))
		expect(chunks.filter((chunk) => chunk.type === "usage")).toEqual([
			{ type: "usage", inputTokens: 10, outputTokens: 5 },
		])

		mocks.stream.mockResolvedValueOnce(events({ choices: [{ delta: { content: "a" } }] }))
		expect((await drain(handlerFor().createMessage("s", []))).map((chunk) => chunk.type)).toEqual(["text"])
	})

	it("reports a failed request to telemetry and rethrows it with the provider name", async () => {
		mocks.stream.mockRejectedValueOnce(new Error("bad request"))
		await expect(drain(handlerFor().createMessage("s", []))).rejects.toThrow(
			"Mistral completion error: bad request",
		)
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			provider: "Mistral",
			operation: "createMessage",
		})
	})
})

describe("completePrompt", () => {
	it.each([
		["string content", "plain", "plain"],
		["no content", undefined, ""],
	])("returns the text of %s", async (_label, content, text) => {
		mocks.complete.mockResolvedValueOnce({ choices: [{ message: { content } }] })
		expect(await handlerFor().completePrompt("p")).toBe(text)
	})

	it("reports a failure to telemetry and rethrows it with the provider name", async () => {
		mocks.complete.mockRejectedValueOnce(new Error("bad request"))
		await expect(handlerFor().completePrompt("p")).rejects.toThrow("Mistral completion error: bad request")
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			provider: "Mistral",
			operation: "completePrompt",
		})
	})
})
