// Characterization of the Mistral handler against the REAL @mistralai/mistralai
// client: only `fetch` is faked. mistral.spec.ts replaces the whole SDK module,
// so nothing else notices when an SDK upgrade changes the request on the wire,
// the parsing of the SSE stream, the error shape or the abort path. Written
// before DEP-6 (SDK 1.x to 2.x) and expected to pass unchanged on both majors.

const mockCaptureException = vi.fn()

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerCreateMessageMetadata } from "../../index"
import type { ApiStreamChunk } from "../../transform/stream"
import { getApiErrorStatus } from "../../apiErrors"
import { MistralHandler } from "../mistral"

type RecordedRequest = {
	url: string
	method: string
	headers: Record<string, string>
	body: unknown
	signal: AbortSignal | undefined
}

// The SDK version is part of this header and changes with every release.
const VERSIONED_HEADERS = new Set(["user-agent"])

const streamChunks = [
	{
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "magistral-medium-latest",
		choices: [
			{
				index: 0,
				delta: {
					role: "assistant",
					content: [{ type: "thinking", thinking: [{ type: "text", text: "Let me think." }] }],
				},
				finish_reason: null,
			},
		],
	},
	{
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "magistral-medium-latest",
		choices: [{ index: 0, delta: { content: [{ type: "text", text: "Reading " }] }, finish_reason: null }],
		// Some servers repeat the cumulative usage in every event (DEF-C12).
		usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103 },
	},
	{
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "magistral-medium-latest",
		choices: [{ index: 0, delta: { content: "it now." }, finish_reason: null }],
	},
	{
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "magistral-medium-latest",
		choices: [
			{
				index: 0,
				delta: {
					content: "",
					tool_calls: [
						{
							id: "abc123XYZ",
							type: "function",
							index: 0,
							function: { name: "read_file", arguments: '{"path":"a.ts"}' },
						},
					],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 },
	},
]

const unaryResponse = {
	id: "cmpl-2",
	object: "chat.completion",
	created: 1,
	model: "codestral-latest",
	choices: [
		{
			index: 0,
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: [{ type: "text", text: "hidden" }] },
					{ type: "text", text: "Sum" },
					{ type: "text", text: "mary." },
				],
			},
			finish_reason: "stop",
		},
	],
	usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
}

let requests: RecordedRequest[]
let respondWith: "ok" | 429

function sseBody(chunks: unknown[]): string {
	return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init)
	const headers: Record<string, string> = {}
	request.headers.forEach((value, key) => {
		headers[key] = VERSIONED_HEADERS.has(key) ? "<versioned>" : value
	})
	const text = request.body ? await request.text() : ""
	requests.push({
		url: request.url,
		method: request.method,
		headers,
		body: text ? JSON.parse(text) : undefined,
		signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
	})

	const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
	if (signal?.aborted) {
		throw new DOMException("This operation was aborted", "AbortError")
	}

	if (respondWith === 429) {
		return new Response(JSON.stringify({ object: "error", message: "Rate limit exceeded", code: "1300" }), {
			status: 429,
			headers: { "content-type": "application/json" },
		})
	}

	if (request.url.endsWith("/v1/chat/completions") && (JSON.parse(text) as { stream?: boolean }).stream) {
		return new Response(sseBody(streamChunks), { status: 200, headers: { "content-type": "text/event-stream" } })
	}

	return new Response(JSON.stringify(unaryResponse), { status: 200, headers: { "content-type": "application/json" } })
}

const history: Anthropic.Messages.MessageParam[] = [
	{
		role: "user",
		content: [
			{ type: "text", text: "Open a.ts" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
		],
	},
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Opening." },
			{ type: "tool_use", id: "call_5019f900a247", name: "read_file", input: { path: "a.ts" } },
		],
	},
	{
		role: "user",
		content: [{ type: "tool_result", tool_use_id: "call_5019f900a247", content: "export const a = 1" }],
	},
]

const tools = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { path: { type: "string", description: "File path" } },
				required: ["path"],
				additionalProperties: false,
			},
		},
	},
] as unknown as ApiHandlerCreateMessageMetadata["tools"]

async function collect(stream: AsyncIterable<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
	const chunks: ApiStreamChunk[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

function metadata(signal?: AbortSignal): ApiHandlerCreateMessageMetadata {
	return { taskId: "task-1", tools, ...(signal ? { signal } : {}) }
}

describe("MistralHandler against the real @mistralai/mistralai client (wire characterization)", () => {
	const options = { mistralApiKey: "test-key", apiModelId: "magistral-medium-latest", includeMaxTokens: true }

	beforeEach(() => {
		requests = []
		respondWith = "ok"
		mockCaptureException.mockClear()
		vi.stubGlobal("fetch", vi.fn(fakeFetch))
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("sends the same streaming chat request", async () => {
		const controller = new AbortController()
		const handler = new MistralHandler(options)

		await collect(handler.createMessage("You are helpful.", history, metadata(controller.signal)))

		expect(requests).toHaveLength(1)
		const [request] = requests
		expect(request.url).toBe("https://api.mistral.ai/v1/chat/completions")
		expect(request.method).toBe("POST")
		expect(request.headers).toEqual({
			accept: "text/event-stream",
			authorization: "Bearer test-key",
			"content-type": "application/json",
			// SDK 1.x always sends an empty cookie header.
			cookie: "",
			"user-agent": "<versioned>",
		})
		expect(request.body).toMatchSnapshot()
	})

	it("sends codestral models to the Codestral endpoint (or the configured URL)", async () => {
		await collect(new MistralHandler({ ...options, apiModelId: "codestral-latest" }).createMessage("s", history))
		await collect(
			new MistralHandler({
				...options,
				apiModelId: "codestral-latest",
				mistralCodestralUrl: "https://proxy.example.com",
			}).createMessage("s", history),
		)

		expect(requests.map((request) => request.url)).toEqual([
			"https://codestral.mistral.ai/v1/chat/completions",
			"https://proxy.example.com/v1/chat/completions",
		])
	})

	it("maps thinking, text (array and string), tool calls and the last usage the same way", async () => {
		const handler = new MistralHandler(options)

		const chunks = await collect(handler.createMessage("sys", history, metadata()))

		expect(chunks).toEqual([
			{ type: "reasoning", text: "Let me think." },
			{ type: "text", text: "Reading " },
			{ type: "text", text: "it now." },
			{
				type: "tool_call_partial",
				index: 0,
				id: "abc123XYZ",
				name: "read_file",
				arguments: '{"path":"a.ts"}',
			},
			{ type: "usage", inputTokens: 100, outputTokens: 12 },
		])
	})

	it("sends the same non-streaming request for completePrompt and keeps only the text parts", async () => {
		const handler = new MistralHandler({ mistralApiKey: "test-key", apiModelId: "codestral-latest" })

		const result = await handler.completePromptWithUsage("Summarize")

		expect(result).toEqual({ text: "Summary.", usage: { inputTokens: 50, outputTokens: 5 } })
		expect(requests[0].url).toBe("https://codestral.mistral.ai/v1/chat/completions")
		expect(requests[0].headers.accept).toBe("application/json")
		expect(requests[0].body).toEqual({
			model: "codestral-latest",
			messages: [{ role: "user", content: "Summarize" }],
			temperature: 1,
			stream: false,
		})
	})

	it("surfaces an HTTP 429 with its status and does not retry (error contract)", async () => {
		respondWith = 429
		const handler = new MistralHandler(options)

		const error = await collect(handler.createMessage("sys", history, metadata())).then(
			() => undefined,
			(e: unknown) => e as Error,
		)

		expect(getApiErrorStatus(error)).toBe(429)
		expect(error?.message).toContain("Mistral completion error")
		expect(error?.message).toContain("Rate limit exceeded")
		expect(mockCaptureException).toHaveBeenCalledTimes(1)
		expect(requests).toHaveLength(1)
	})

	it("surfaces an HTTP 429 from completePrompt with its status", async () => {
		respondWith = 429
		const handler = new MistralHandler(options)

		const error = await handler.completePrompt("x").then(
			() => undefined,
			(e: unknown) => e,
		)

		expect(getApiErrorStatus(error)).toBe(429)
		expect(requests).toHaveLength(1)
	})

	it("hands the task signal to fetch (API-5): Stop aborts the request", async () => {
		const controller = new AbortController()
		const handler = new MistralHandler(options)

		await collect(handler.createMessage("sys", history, metadata(controller.signal)))

		const { signal } = requests[0]
		expect(signal).toBeInstanceOf(AbortSignal)
		expect(signal?.aborted).toBe(false)
		controller.abort()
		expect(signal?.aborted).toBe(true)
	})

	it("rejects without a response when the task signal is already aborted", async () => {
		const controller = new AbortController()
		controller.abort()
		const handler = new MistralHandler(options)

		await expect(collect(handler.createMessage("sys", history, metadata(controller.signal)))).rejects.toThrow()
		expect(requests.every((request) => request.signal?.aborted)).toBe(true)
	})
})
