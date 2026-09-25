// DEF-C14: Moonshot stream failures must reach the task as thrown errors. These
// tests drive the handler's real client library against a stubbed `fetch`, so
// they pin what the installed client actually does, not what a mock claims. They
// were written against the Vercel AI SDK path (which emitted `{ type: "error" }`
// parts instead of throwing) and must keep passing on the OpenAI SDK path (API-4).

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

describe("MoonshotHandler stream errors (DEF-C14, real client library)", () => {
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

	it("delivers an incrementally streamed tool call as tool_call_partial chunks plus the finish reason", async () => {
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
		// API-4: the tool call arrives the way every Chat Completions provider sends it,
		// as tool_call_partial chunks (TaskStreamProcessor feeds them to the
		// NativeToolCallParser, which also drives the live preview) and a finish_reason
		// that finalizes it. The AI SDK path used to hide the partials and send one
		// complete tool_call chunk at the end.
		expect(chunks.filter((c) => c.type === "tool_call")).toEqual([])
		const partials = chunks.filter((c) => c.type === "tool_call_partial")
		expect(partials[0]).toMatchObject({ index: 0, id: "call_1", name: "read_file" })
		expect(partials.map((c) => c.arguments ?? "").join("")).toBe('{"path":"a.ts"}')
		expect(chunks).toContainEqual({ type: "finish_reason", finishReason: "tool_calls" })
	})
})
