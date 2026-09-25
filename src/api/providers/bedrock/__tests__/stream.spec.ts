// cd src && ./node_modules/.bin/vitest run api/providers/bedrock/__tests__/stream.spec.ts

// Unit tests of the Bedrock ConverseStream event processor split out of
// AwsBedrockHandler.createMessage (API-18). The full scripted stream is pinned in
// bedrock-characterization.spec.ts.

vi.mock("../../../../utils/logging", () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import type { ApiStreamChunk } from "../../../transform/stream"
import {
	chunksFromContentBlockDelta,
	chunksFromContentBlockStart,
	parseBedrockStreamEvent,
	processBedrockStream,
	usageChunkFromMetadata,
	usageChunkFromPromptRouter,
} from "../stream"

async function* from(events: unknown[]) {
	for (const event of events) {
		yield event
	}
}

async function collect(stream: AsyncIterable<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

describe("bedrock stream processing", () => {
	it("parses objects as they are, JSON strings, and skips invalid JSON", () => {
		const event = { messageStart: {} }
		expect(parseBedrockStreamEvent(event)).toEqual({ event })
		expect(parseBedrockStreamEvent('{"messageStop":{}}')).toEqual({ event: { messageStop: {} } })
		expect(parseBedrockStreamEvent("{oops")).toBeUndefined()
	})

	it("normalizes both cache field namings in usage", () => {
		expect(usageChunkFromMetadata({ inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3 })).toEqual({
			type: "usage",
			inputTokens: 1,
			outputTokens: 2,
			cacheReadTokens: 3,
			cacheWriteTokens: 0,
		})
		expect(usageChunkFromMetadata({ cacheWriteInputTokenCount: 4 })).toEqual({
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 4,
		})
		expect(
			usageChunkFromPromptRouter({ inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8 }),
		).toEqual({ type: "usage", inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8 })
	})

	it("maps content block starts", () => {
		expect(
			chunksFromContentBlockStart({ contentBlockIndex: 2, contentBlock: { reasoningContent: { text: "r" } } }),
		).toEqual([
			{ type: "reasoning", text: "\n" },
			{ type: "reasoning", text: "r" },
		])
		expect(chunksFromContentBlockStart({ content_block: { type: "thinking", thinking: "t" } })).toEqual([
			{ type: "reasoning", text: "t" },
		])
		expect(
			chunksFromContentBlockStart({ contentBlockIndex: 1, start: { toolUse: { toolUseId: "a", name: "b" } } }),
		).toEqual([{ type: "tool_call_partial", index: 1, id: "a", name: "b", arguments: undefined }])
		expect(chunksFromContentBlockStart({ start: { text: "hi" } })).toEqual([{ type: "text", text: "hi" }])
		expect(chunksFromContentBlockStart({})).toEqual([])
	})

	it("maps content block deltas", () => {
		expect(chunksFromContentBlockDelta({ delta: { reasoningContent: { text: "r" }, text: "ignored" } })).toEqual([
			{ type: "reasoning", text: "r" },
		])
		expect(chunksFromContentBlockDelta({ contentBlockIndex: 3, delta: { toolUse: { input: "{" } } })).toEqual([
			{ type: "tool_call_partial", index: 3, id: undefined, name: undefined, arguments: "{" },
		])
		expect(chunksFromContentBlockDelta({ delta: { type: "thinking_delta", thinking: "t" } })).toEqual([
			{ type: "reasoning", text: "t" },
		])
		expect(chunksFromContentBlockDelta({ delta: { text: "x" } })).toEqual([{ type: "text", text: "x" }])
		expect(chunksFromContentBlockDelta({})).toEqual([])
	})

	it("processes a stream, reporting the prompt router's invoked model", async () => {
		const onInvokedModelId = vi.fn()
		const chunks = await collect(
			processBedrockStream(
				from([
					{ messageStart: { role: "assistant" } },
					{
						trace: {
							promptRouter: { invokedModelId: "arn:x", usage: { inputTokens: 1, outputTokens: 1 } },
						},
					},
					{ contentBlockDelta: { delta: { text: "hi" } } },
					{ metadata: { usage: { inputTokens: 2, outputTokens: 3 } } },
					{ messageStop: {} },
				]),
				{ onInvokedModelId },
			),
		)
		expect(onInvokedModelId).toHaveBeenCalledWith("arn:x")
		expect(chunks).toEqual([
			{ type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
			{ type: "text", text: "hi" },
			{ type: "usage", inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
		])
	})

	it("keeps going when the invoked-model hook throws", async () => {
		const chunks = await collect(
			processBedrockStream(
				from([
					{ trace: { promptRouter: { invokedModelId: "bad", usage: { inputTokens: 1, outputTokens: 1 } } } },
					{ contentBlockDelta: { delta: { text: "after" } } },
				]),
				{
					onInvokedModelId: () => {
						throw new Error("boom")
					},
				},
			),
		)
		expect(chunks).toEqual([{ type: "text", text: "after" }])
	})
})
