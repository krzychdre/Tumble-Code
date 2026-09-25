// DEP-6: the API-2 characterization spec replaces the SDK with a mock, so it
// cannot notice an SDK upgrade changing what goes over the wire or how the
// server-sent events are parsed. This spec runs the REAL @anthropic-ai/sdk and
// @anthropic-ai/vertex-sdk against a faked `fetch`: the same scripted event
// stream is sent as SSE text, and the spec pins the chunk list, the endpoint,
// the auth and beta headers, and the cache_control breakpoints in the body.

vitest.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: vitest.fn().mockReturnValue(600_000),
}))

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

import type { Anthropic } from "@anthropic-ai/sdk"
import type { MockInstance } from "vitest"
import { GoogleAuth, OAuth2Client } from "google-auth-library"

import { calculateApiCostAnthropic } from "../../../shared/cost"
import type { ApiStreamChunk } from "../../transform/stream"
import type { ApiHandler } from "../../index"
import { AnthropicHandler } from "../anthropic"
import { MiniMaxHandler } from "../minimax"
import { AnthropicVertexHandler } from "../anthropic-vertex"

// The same events as the API-2 characterization spec.
const SCRIPTED_EVENTS = [
	{
		type: "message_start",
		message: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "test-model",
			content: [],
			stop_reason: null,
			stop_sequence: null,
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

// The chunk list the characterization spec pins for the mocked SDK.
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

const CONVERSATION: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "First question" },
	{ role: "assistant", content: "First answer" },
	{ role: "user", content: [{ type: "text", text: "Second question" }] },
]

function sseResponse(): Response {
	const body = SCRIPTED_EVENTS.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

type WireCase = {
	name: string
	build: () => ApiHandler
	url: string
	auth: [header: string, value: string]
	/** anthropic-beta values the request must carry (order-insensitive). */
	betas: string[]
}

const CASES: WireCase[] = [
	{
		name: "Anthropic",
		build: () => new AnthropicHandler({ apiKey: "test-key", apiModelId: "claude-sonnet-4-5" }),
		url: "https://api.anthropic.com/v1/messages",
		auth: ["x-api-key", "test-key"],
		betas: ["fine-grained-tool-streaming-2025-05-14", "prompt-caching-2024-07-31"],
	},
	{
		name: "MiniMax",
		build: () => new MiniMaxHandler({ minimaxApiKey: "test-key", apiModelId: "MiniMax-M2.7" }),
		url: "https://api.minimax.io/anthropic/v1/messages",
		auth: ["x-api-key", "test-key"],
		betas: [],
	},
	{
		name: "Anthropic Vertex",
		build: () =>
			new AnthropicVertexHandler({
				apiModelId: "claude-sonnet-4-5@20250929",
				vertexProjectId: "test-project",
				vertexRegion: "us-east5",
			}),
		url: "https://us-east5-aiplatform.googleapis.com/v1/projects/test-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-5@20250929:streamRawPredict",
		auth: ["authorization", "Bearer test-access-token"],
		betas: [],
	},
]

describe("Anthropic-protocol handlers over the real SDK (DEP-6 wire)", () => {
	let fetchSpy: MockInstance<typeof fetch>

	beforeEach(() => {
		// The SDK reads these when the client is built; a developer shell (Claude
		// Code sets ANTHROPIC_BASE_URL) must not change the pinned request.
		for (const name of [
			"ANTHROPIC_BASE_URL",
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_AUTH_TOKEN",
			"ANTHROPIC_CUSTOM_HEADERS",
			"ANTHROPIC_VERTEX_BASE_URL",
		]) {
			vitest.stubEnv(name, undefined)
		}
		const authClient = new OAuth2Client()
		authClient.setCredentials({ access_token: "test-access-token", expiry_date: Date.now() + 60 * 60 * 1000 })
		vitest.spyOn(GoogleAuth.prototype, "getClient").mockResolvedValue(authClient as any)
		// The SDKs pick up the global fetch when the client is built.
		fetchSpy = vitest.spyOn(globalThis, "fetch").mockImplementation(async () => sseResponse())
	})

	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllEnvs()
	})

	describe.each(CASES)("$name", ({ build, url, auth, betas }) => {
		it("parses the SSE stream into the pinned chunk list", async () => {
			const handler = build()
			const chunks: ApiStreamChunk[] = []
			for await (const chunk of handler.createMessage("You are a test.", CONVERSATION)) {
				chunks.push(chunk)
			}

			const { totalCost } = calculateApiCostAnthropic(handler.getModel().info, 1000, 120, 200, 300)
			expect(chunks).toEqual([...TOKEN_CHUNKS, { type: "usage", inputTokens: 0, outputTokens: 0, totalCost }])
		})

		it("sends one streaming request with the auth header, betas and cache_control breakpoints", async () => {
			const handler = build()
			for await (const _chunk of handler.createMessage("You are a test.", CONVERSATION)) {
				// drain
			}

			expect(fetchSpy).toHaveBeenCalledTimes(1)
			const [input, init] = fetchSpy.mock.calls[0]
			const request = new Request(input, init)

			expect(request.method).toBe("POST")
			expect(request.url).toBe(url)
			expect(request.headers.get(auth[0])).toBe(auth[1])
			const sentBetas = (request.headers.get("anthropic-beta") ?? "").split(",").filter(Boolean)
			expect([...sentBetas].sort()).toEqual([...betas].sort())

			const body = JSON.parse(await request.text())
			expect(body.stream).toBe(true)
			// Prompt caching (the Opus 5 fix keyed on supportsPromptCache): the
			// system prompt and the last user message carry the breakpoint.
			expect(body.system).toEqual([
				{ type: "text", text: "You are a test.", cache_control: { type: "ephemeral" } },
			])
			const lastUser = body.messages[body.messages.length - 1]
			expect(lastUser.role).toBe("user")
			expect(lastUser.content.at(-1).cache_control).toEqual({ type: "ephemeral" })
		})

		it("rejects without a request when the task signal is already aborted", async () => {
			const controller = new AbortController()
			controller.abort()

			const iterator = build().createMessage("You are a test.", CONVERSATION, {
				taskId: "t1",
				signal: controller.signal,
			})

			await expect(iterator.next()).rejects.toThrow()
			expect(fetchSpy).not.toHaveBeenCalled()
		})
	})
})
