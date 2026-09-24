// DEF-C14: Moonshot is the only provider on the Vercel AI SDK path
// (OpenAICompatibleHandler -> streamText -> processAiSdkStreamPart). The AI SDK
// does not throw from `fullStream` when the request or the stream fails: it
// emits an `{ type: "error" }` part and ends the stream. These tests drive the
// REAL `ai` + `@ai-sdk/openai-compatible` packages against a stubbed `fetch`,
// so they pin what the installed SDK actually emits, not what a mock claims.

import type { Anthropic } from "@anthropic-ai/sdk"

import { MoonshotHandler } from "../moonshot"

const systemPrompt = "You are a helpful assistant."
const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: [{ type: "text", text: "Hello!" }] }]

function sse(events: Array<object | string>): Response {
	const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("")
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

async function drain(handler: MoonshotHandler, metadata?: Parameters<MoonshotHandler["createMessage"]>[2]) {
	const chunks: any[] = []
	let thrown: unknown
	try {
		for await (const chunk of handler.createMessage(systemPrompt, messages, metadata)) {
			chunks.push(chunk)
		}
	} catch (error) {
		thrown = error
	}
	return { chunks, thrown }
}

describe("MoonshotHandler stream errors (DEF-C14, real AI SDK)", () => {
	let fetchMock: ReturnType<typeof vi.fn>
	let handler: MoonshotHandler

	beforeEach(() => {
		fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		handler = new MoonshotHandler({
			moonshotApiKey: "test-key",
			apiModelId: "kimi-k2-0905-preview",
			moonshotBaseUrl: "https://api.moonshot.ai/v1",
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("throws the provider's HTTP 429 before yielding anything, so the first-chunk retry path handles it", async () => {
		// retry-after-ms keeps the SDK's own internal retries (maxRetries 2) instant.
		fetchMock.mockImplementation(
			async () =>
				new Response(JSON.stringify({ error: { message: "rate limited by moonshot", type: "rate_limit" } }), {
					status: 429,
					headers: { "content-type": "application/json", "retry-after-ms": "1" },
				}),
		)

		const { chunks, thrown } = await drain(handler)

		// Nothing may reach the task before the error: an ignored `error` chunk
		// would count as the "first chunk" and bypass handleApiRequestError.
		expect(chunks).toEqual([])
		expect(thrown).toBeInstanceOf(Error)
		// The real reason, not the SDK's follow-up "No output generated".
		expect((thrown as Error).message).toContain("rate limited by moonshot")
	})

	it("throws an in-band stream error instead of ending the turn normally", async () => {
		fetchMock.mockImplementation(async () =>
			sse([
				{ id: "1", choices: [{ index: 0, delta: { content: "Hel" } }] },
				{ error: { message: "engine overloaded", type: "server_error" } },
				"[DONE]",
			]),
		)

		const { chunks, thrown } = await drain(handler)

		expect(chunks.filter((c) => c.type === "text").map((c) => c.text)).toEqual(["Hel"])
		expect(thrown).toBeInstanceOf(Error)
		expect((thrown as Error).message).toContain("engine overloaded")
	})

	it("delivers an incrementally streamed tool call as exactly one complete tool_call chunk", async () => {
		fetchMock.mockImplementation(async () =>
			sse([
				{
					id: "1",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_1",
										type: "function",
										function: { name: "read_file", arguments: "" },
									},
								],
							},
						},
					],
				},
				{
					id: "1",
					choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }],
				},
				{
					id: "1",
					choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] } }],
				},
				{ id: "1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
				"[DONE]",
			]),
		)

		const { chunks, thrown } = await drain(handler, {
			taskId: "t",
			tools: [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
					},
				},
			],
		})

		expect(thrown).toBeUndefined()
		// TaskStreamProcessor has no case for tool_call_start/delta/end (only the
		// NativeToolCallParser emits those, as events), so the tool call reaches
		// the task through this single complete chunk. It must be there once.
		const toolCalls = chunks.filter((c) => c.type === "tool_call")
		expect(toolCalls).toEqual([{ type: "tool_call", id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' }])
	})
})
