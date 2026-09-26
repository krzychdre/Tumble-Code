// npx vitest run src/api/providers/__tests__/anthropic-protocol-characterization.spec.ts
//
// API-2 characterization: one scripted Anthropic Messages stream replayed
// through the three handlers that speak the Anthropic protocol (Anthropic,
// MiniMax, Anthropic on Vertex), pinning the exact chunk list each one yields,
// plus the request each one sends (cache_control placement, system prompt,
// headers). The handlers share one stream adapter and one cache_control helper
// after API-2; these tests keep that move honest.

vitest.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: vitest.fn().mockReturnValue(600_000),
}))

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

const mockCreate = vitest.fn()

vitest.mock("@anthropic-ai/sdk", () => ({
	Anthropic: vitest.fn().mockImplementation(function () {
		return { messages: { create: mockCreate } }
	}),
}))

vitest.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: vitest.fn().mockImplementation(function () {
		return { messages: { create: mockCreate } }
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { calculateApiCostAnthropic } from "../../../shared/cost"
import type { ApiStreamChunk } from "../../transform/stream"
import type { ApiHandler } from "../../index"
import { AnthropicHandler } from "../anthropic"
import { MiniMaxHandler } from "../minimax"
import { AnthropicVertexHandler } from "../anthropic-vertex"

// message_start with cache usage, a thinking block with two deltas and a
// signature, a redacted thinking block, a text block, a tool_use block with
// two input_json deltas, then the cumulative output usage in message_delta.
const SCRIPTED_EVENTS = [
	{
		type: "message_start",
		message: {
			id: "msg_1",
			usage: {
				input_tokens: 1000,
				output_tokens: 1,
				cache_creation_input_tokens: 200,
				cache_read_input_tokens: 300,
			},
		},
	},
	{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me " } },
	{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "think." } },
	{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "opaque" } },
	{ type: "content_block_stop", index: 1 },
	{ type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Reading the file." } },
	{ type: "content_block_stop", index: 2 },
	{
		type: "content_block_start",
		index: 3,
		content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
	},
	{ type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"path":' } },
	{ type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '"a.ts"}' } },
	{ type: "content_block_stop", index: 3 },
	{ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 120 } },
	{ type: "message_stop" },
]

function scriptedStream() {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of SCRIPTED_EVENTS) {
				yield event
			}
		},
	}
}

// The chunks every handler yields for the scripted stream, before any cost chunk.
const TOKEN_CHUNKS: ApiStreamChunk[] = [
	{ type: "usage", inputTokens: 1000, outputTokens: 1, cacheWriteTokens: 200, cacheReadTokens: 300 },
	{ type: "reasoning", text: "" },
	{ type: "reasoning", text: "Let me " },
	{ type: "reasoning", text: "think." },
	{ type: "text", text: "\n" },
	{ type: "text", text: "" },
	{ type: "text", text: "Reading the file." },
	{ type: "tool_call_partial", index: 3, id: "toolu_1", name: "read_file", arguments: undefined },
	{ type: "tool_call_partial", index: 3, id: undefined, name: undefined, arguments: '{"path":' },
	{ type: "tool_call_partial", index: 3, id: undefined, name: undefined, arguments: '"a.ts"}' },
	{ type: "usage", inputTokens: 0, outputTokens: 120 },
]

// A conversation whose user turns cover the content shapes that matter for
// cache_control: a plain string (too old to be marked), an array ending in an
// image, and an array ending in a tool_result (the new user message).
const CONVERSATION: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "First question" },
	{ role: "assistant", content: "First answer" },
	{
		role: "user",
		content: [
			{ type: "text", text: "Look at this" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
		],
	},
	{
		role: "assistant",
		content: [{ type: "tool_use", id: "toolu_0", name: "read_file", input: { path: "a.ts" } }],
	},
	{
		role: "user",
		content: [
			{ type: "text", text: "Before the result" },
			{ type: "tool_result", tool_use_id: "toolu_0", content: "file body" },
		],
	},
]

type HandlerCase = {
	name: string
	build: () => ApiHandler
}

const HANDLERS: HandlerCase[] = [
	{
		name: "Anthropic",
		build: () => new AnthropicHandler({ apiKey: "test-key", apiModelId: "claude-sonnet-4-5" }),
	},
	{
		name: "MiniMax",
		build: () => new MiniMaxHandler({ minimaxApiKey: "test-key", apiModelId: "MiniMax-M2.7" }),
	},
	{
		name: "Anthropic Vertex",
		build: () =>
			new AnthropicVertexHandler({
				apiModelId: "claude-sonnet-4-5@20250929",
				vertexProjectId: "test-project",
				vertexRegion: "us-east5",
			}),
	},
]

async function collect(handler: ApiHandler, messages: Anthropic.Messages.MessageParam[]) {
	const chunks: ApiStreamChunk[] = []
	for await (const chunk of handler.createMessage("You are a test.", messages)) {
		chunks.push(chunk)
	}
	return chunks
}

describe("Anthropic-protocol handlers (API-2 characterization)", () => {
	beforeEach(() => {
		mockCreate.mockReset()
		mockCreate.mockImplementation(async () => scriptedStream())
	})

	describe.each(HANDLERS)("$name", ({ build }) => {
		it("yields the pinned chunk list for the scripted stream", async () => {
			const handler = build()
			const chunks = await collect(handler, [{ role: "user", content: "Hi" }])

			// Every handler ends with the cost of the cumulative message_delta
			// output (120), not 1 + 120. Vertex yielded no cost chunk before
			// API-2: the task priced the summed usage chunks instead, counting
			// the message_start output on top of the cumulative one.
			const { totalCost } = calculateApiCostAnthropic(handler.getModel().info, 1000, 120, 200, 300)
			expect(totalCost).toBeGreaterThan(0)

			expect(chunks).toEqual([...TOKEN_CHUNKS, { type: "usage", inputTokens: 0, outputTokens: 0, totalCost }])
		})

		it("yields no cost chunk when the stream reports no usage at all", async () => {
			mockCreate.mockImplementation(async () => ({
				async *[Symbol.asyncIterator]() {
					yield { type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }
					yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "ok" } }
					yield { type: "message_delta", delta: {}, usage: { output_tokens: 0 } }
				},
			}))

			const chunks = await collect(build(), [{ role: "user", content: "Hi" }])

			expect(chunks).toEqual([
				{
					type: "usage",
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: undefined,
					cacheReadTokens: undefined,
				},
				{ type: "text", text: "ok" },
				{ type: "usage", inputTokens: 0, outputTokens: 0 },
			])
		})
	})

	describe("request cache_control placement", () => {
		it("Anthropic marks the system prompt and the last block of the last two user messages", async () => {
			await collect(HANDLERS[0].build(), CONVERSATION)

			expect(mockCreate).toHaveBeenCalledTimes(1)
			const [params, options] = mockCreate.mock.calls[0]
			expect(params.system).toMatchInlineSnapshot(`
				[
				  {
				    "cache_control": {
				      "type": "ephemeral",
				    },
				    "text": "You are a test.",
				    "type": "text",
				  },
				]
			`)
			expect(params.messages).toMatchInlineSnapshot(`
				[
				  {
				    "content": "First question",
				    "role": "user",
				  },
				  {
				    "content": "First answer",
				    "role": "assistant",
				  },
				  {
				    "content": [
				      {
				        "text": "Look at this",
				        "type": "text",
				      },
				      {
				        "cache_control": {
				          "type": "ephemeral",
				        },
				        "source": {
				          "data": "AAAA",
				          "media_type": "image/png",
				          "type": "base64",
				        },
				        "type": "image",
				      },
				    ],
				    "role": "user",
				  },
				  {
				    "content": [
				      {
				        "id": "toolu_0",
				        "input": {
				          "path": "a.ts",
				        },
				        "name": "read_file",
				        "type": "tool_use",
				      },
				    ],
				    "role": "assistant",
				  },
				  {
				    "content": [
				      {
				        "text": "Before the result",
				        "type": "text",
				      },
				      {
				        "cache_control": {
				          "type": "ephemeral",
				        },
				        "content": "file body",
				        "tool_use_id": "toolu_0",
				        "type": "tool_result",
				      },
				    ],
				    "role": "user",
				  },
				]
			`)
			expect(options).toMatchInlineSnapshot(`
				{
				  "headers": {
				    "anthropic-beta": "fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31",
				  },
				  "signal": undefined,
				}
			`)
		})

		it("MiniMax marks the system prompt and the last block of the last two user messages", async () => {
			await collect(HANDLERS[1].build(), CONVERSATION)

			expect(mockCreate).toHaveBeenCalledTimes(1)
			const [params, options] = mockCreate.mock.calls[0]
			expect(params.system).toMatchInlineSnapshot(`
				[
				  {
				    "cache_control": {
				      "type": "ephemeral",
				    },
				    "text": "You are a test.",
				    "type": "text",
				  },
				]
			`)
			expect(params.messages).toMatchInlineSnapshot(`
				[
				  {
				    "content": "First question",
				    "role": "user",
				  },
				  {
				    "content": "First answer",
				    "role": "assistant",
				  },
				  {
				    "content": [
				      {
				        "text": "Look at this",
				        "type": "text",
				      },
				      {
				        "cache_control": {
				          "type": "ephemeral",
				        },
				        "source": {
				          "data": "AAAA",
				          "media_type": "image/png",
				          "type": "base64",
				        },
				        "type": "image",
				      },
				    ],
				    "role": "user",
				  },
				  {
				    "content": [
				      {
				        "id": "toolu_0",
				        "input": {
				          "path": "a.ts",
				        },
				        "name": "read_file",
				        "type": "tool_use",
				      },
				    ],
				    "role": "assistant",
				  },
				  {
				    "content": [
				      {
				        "cache_control": {
				          "type": "ephemeral",
				        },
				        "content": "file body

				Before the result",
				        "tool_use_id": "toolu_0",
				        "type": "tool_result",
				      },
				    ],
				    "role": "user",
				  },
				]
			`)
			expect(options).toMatchInlineSnapshot(`
				{
				  "signal": undefined,
				}
			`)
		})

		it("Vertex marks the system prompt and the last text block of the last two user messages", async () => {
			await collect(HANDLERS[2].build(), CONVERSATION)

			expect(mockCreate).toHaveBeenCalledTimes(1)
			const [params, options] = mockCreate.mock.calls[0]
			expect(params.system).toMatchInlineSnapshot(`
				[
				  {
				    "cache_control": {
				      "type": "ephemeral",
				    },
				    "text": "You are a test.",
				    "type": "text",
				  },
				]
			`)
			expect(params.messages).toMatchInlineSnapshot(`
				[
				  {
				    "content": "First question",
				    "role": "user",
				  },
				  {
				    "content": "First answer",
				    "role": "assistant",
				  },
				  {
				    "content": [
				      {
				        "cache_control": {
				          "type": "ephemeral",
				        },
				        "text": "Look at this",
				        "type": "text",
				      },
				      {
				        "source": {
				          "data": "AAAA",
				          "media_type": "image/png",
				          "type": "base64",
				        },
				        "type": "image",
				      },
				    ],
				    "role": "user",
				  },
				  {
				    "content": [
				      {
				        "id": "toolu_0",
				        "input": {
				          "path": "a.ts",
				        },
				        "name": "read_file",
				        "type": "tool_use",
				      },
				    ],
				    "role": "assistant",
				  },
				  {
				    "content": [
				      {
				        "cache_control": {
				          "type": "ephemeral",
				        },
				        "text": "Before the result",
				        "type": "text",
				      },
				      {
				        "content": "file body",
				        "tool_use_id": "toolu_0",
				        "type": "tool_result",
				      },
				    ],
				    "role": "user",
				  },
				]
			`)
			expect(options).toMatchInlineSnapshot(`
				{
				  "signal": undefined,
				}
			`)
		})

		it("does not mutate the caller's messages", async () => {
			const before = structuredClone(CONVERSATION)
			for (const { build } of HANDLERS) {
				await collect(build(), CONVERSATION)
			}
			expect(CONVERSATION).toEqual(before)
		})
	})
})
