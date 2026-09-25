// Characterization of the native Ollama handler against the REAL `ollama` client:
// only `fetch` is faked (and the model list, which comes from axios, not from the
// SDK). native-ollama.spec replaces `client.chat`, so nothing else notices when an
// SDK upgrade changes the request on the wire, the NDJSON parsing, the error shape
// or how the streamed answer is aborted. Written before DEP-6 (0.5.x to 0.6.x) and
// expected to pass unchanged on both, except the multi-byte case at the end, which
// 0.5.x gets wrong.

vi.mock("../fetchers/ollama", () => ({
	getOllamaModels: vi.fn(async () => ({})),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerCreateMessageMetadata } from "../../index"
import type { ApiStreamChunk } from "../../transform/stream"
import { NativeOllamaHandler } from "../native-ollama"

type RecordedRequest = {
	url: string
	method: string | undefined
	headers: Record<string, string>
	body: unknown
	signal: AbortSignal | undefined
}

type FakeAnswer =
	| { kind: "ndjson"; chunks: Uint8Array[] }
	| { kind: "json"; body: unknown }
	| { kind: "error"; status: number; body: unknown }
	/** Sends `first`, then keeps the connection open until the request is aborted. */
	| { kind: "hang-after"; first: Uint8Array }
	/** Answers only when the test calls `release()`. */
	| { kind: "late"; chunks: Uint8Array[] }

const encoder = new TextEncoder()

function ndjson(lines: unknown[]): Uint8Array {
	return encoder.encode(lines.map((line) => JSON.stringify(line) + "\n").join(""))
}

const streamLines = [
	{ model: "llama3.1", created_at: "t", message: { role: "assistant", content: "<think>plan it" }, done: false },
	{ model: "llama3.1", created_at: "t", message: { role: "assistant", content: "</think>Hello" }, done: false },
	// The server's separate reasoning field (sent when the request sets `think`); the handler reads only `content`.
	{
		model: "llama3.1",
		created_at: "t",
		message: { role: "assistant", content: "", thinking: "hidden" },
		done: false,
	},
	{
		model: "llama3.1",
		created_at: "t",
		message: {
			role: "assistant",
			content: "",
			tool_calls: [{ function: { name: "read_file", arguments: { path: "a.ts" } } }],
		},
		done: false,
	},
	{
		model: "llama3.1",
		created_at: "t",
		message: { role: "assistant", content: "" },
		done: true,
		done_reason: "stop",
		prompt_eval_count: 120,
		eval_count: 30,
	},
]

let requests: RecordedRequest[]
let answer: FakeAnswer
let release: () => void

// The User-Agent carries the SDK version and the platform.
const VERSIONED_HEADERS = new Set(["user-agent"])

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk)
			controller.close()
		},
	})
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const headers: Record<string, string> = {}
	new Headers(init?.headers).forEach((value, key) => {
		headers[key] = VERSIONED_HEADERS.has(key) ? "<versioned>" : value
	})
	requests.push({
		url: String(input),
		method: init?.method,
		headers,
		body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
		signal: init?.signal ?? undefined,
	})
	const ndjsonHeaders = { "content-type": "application/x-ndjson" }

	switch (answer.kind) {
		case "ndjson":
			return new Response(bodyOf(answer.chunks), { status: 200, headers: ndjsonHeaders })
		case "json":
			return new Response(JSON.stringify(answer.body), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		case "error":
			return new Response(JSON.stringify(answer.body), {
				status: answer.status,
				headers: { "content-type": "application/json" },
			})
		case "hang-after": {
			const first = answer.first
			const signal = init?.signal
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(first)
					// Like a real connection: aborting the request errors the body.
					signal?.addEventListener("abort", () =>
						controller.error(new DOMException("This operation was aborted", "AbortError")),
					)
				},
			})
			return new Response(body, { status: 200, headers: ndjsonHeaders })
		}
		case "late": {
			const chunks = answer.chunks
			await new Promise<void>((resolve) => (release = resolve))
			return new Response(bodyOf(chunks), { status: 200, headers: ndjsonHeaders })
		}
	}
}

async function collect(stream: AsyncIterable<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = []
	let error: any
	try {
		for await (const chunk of stream) chunks.push(chunk)
	} catch (caught) {
		error = caught
	}
	return { chunks, error }
}

const messages: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: [{ type: "text", text: "Read a.ts" }] },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Reading." },
			{ type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
		],
	},
	{
		role: "user",
		content: [
			{ type: "tool_result", tool_use_id: "t1", content: "export const a = 1" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
		],
	},
]

const tools = [
	{
		type: "function" as const,
		function: {
			name: "read_file",
			description: "Read a file",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		},
	},
]

function newHandler(extra: Record<string, unknown> = {}) {
	return new NativeOllamaHandler({
		ollamaModelId: "llama3.1",
		ollamaBaseUrl: "http://localhost:11434",
		...extra,
	})
}

beforeEach(() => {
	requests = []
	answer = { kind: "ndjson", chunks: [ndjson(streamLines)] }
	release = () => {}
	vi.stubGlobal("fetch", vi.fn(fakeFetch))
	vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("native Ollama wire characterization (real ollama client, fake fetch)", () => {
	it("sends the streaming chat request with messages, options and tools", async () => {
		const handler = newHandler({ ollamaApiKey: "secret", modelTemperature: 0.3, ollamaNumCtx: 8192 })

		await collect(handler.createMessage("You are helpful.", messages, { taskId: "task-1", tools }))

		expect(requests).toHaveLength(1)
		expect(requests[0]).toMatchObject({ url: "http://localhost:11434/api/chat", method: "POST" })
		expect(requests[0].headers).toEqual({
			accept: "application/json",
			authorization: "Bearer secret",
			"content-type": "application/json",
			"user-agent": "<versioned>",
		})
		expect(requests[0].body).toEqual({
			model: "llama3.1",
			stream: true,
			options: { temperature: 0.3, num_ctx: 8192 },
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
			messages: [
				{ role: "system", content: "You are helpful." },
				{ role: "user", content: "Read a.ts" },
				{
					role: "assistant",
					content: "Reading.",
					tool_calls: [{ function: { name: "read_file", arguments: { path: "a.ts" } } }],
				},
				{ role: "user", content: "export const a = 1" },
				{ role: "user", content: "", images: ["iVBORw0KGgo="] },
			],
		})
		expect(requests[0].signal).toBeInstanceOf(AbortSignal)
	})

	it("sends no Authorization header without an API key", async () => {
		await collect(newHandler().createMessage("s", [{ role: "user", content: "Hi" }]))

		expect(Object.keys(requests[0].headers).sort()).toEqual(["accept", "content-type", "user-agent"])
	})

	it("parses the NDJSON stream into text, reasoning, tool calls and usage", async () => {
		const { chunks, error } = await collect(
			newHandler().createMessage("s", [{ role: "user", content: "Hi" }], { taskId: "task-1", tools }),
		)

		expect(error).toBeUndefined()
		expect(chunks).toEqual([
			{ type: "reasoning", text: "plan it" },
			{ type: "text", text: "Hello" },
			{
				type: "tool_call_partial",
				index: 0,
				id: "ollama-tool-0",
				name: "read_file",
				arguments: '{"path":"a.ts"}',
			},
			{ type: "tool_call_end", id: "ollama-tool-0" },
			{ type: "usage", inputTokens: 120, outputTokens: 30 },
		])
	})

	it("parses lines split across network chunks", async () => {
		const whole = ndjson(streamLines)
		answer = { kind: "ndjson", chunks: [whole.slice(0, 17), whole.slice(17, 140), whole.slice(140)] }

		const { chunks, error } = await collect(newHandler().createMessage("s", [{ role: "user", content: "Hi" }]))

		expect(error).toBeUndefined()
		expect(chunks.filter((chunk) => chunk.type === "text")).toEqual([{ type: "text", text: "Hello" }])
		expect(chunks.at(-1)).toEqual({ type: "usage", inputTokens: 120, outputTokens: 30 })
	})

	it("sends the one-shot completion with stream false and reads text and usage", async () => {
		answer = {
			kind: "json",
			body: {
				model: "llama3.1",
				created_at: "t",
				message: { role: "assistant", content: "Summary." },
				done: true,
				prompt_eval_count: 50,
				eval_count: 5,
			},
		}

		const result = await newHandler().completePromptWithUsage("Summarize")

		expect(requests[0].url).toBe("http://localhost:11434/api/chat")
		expect(requests[0].body).toEqual({
			model: "llama3.1",
			messages: [{ role: "user", content: "Summarize" }],
			stream: false,
			options: { temperature: 0 },
		})
		expect(result).toEqual({ text: "Summary.", usage: { inputTokens: 50, outputTokens: 5 } })
	})

	it("turns a 404 into the pull hint and keeps status 404 (ResponseError.status_code)", async () => {
		answer = { kind: "error", status: 404, body: { error: 'model "llama3.1" not found, try pulling it first' } }

		const { error } = await collect(newHandler().createMessage("s", [{ role: "user", content: "Hi" }]))

		expect(error.message).toBe(
			"Model llama3.1 not found in Ollama. Please pull the model first with: ollama pull llama3.1",
		)
		expect(error.status).toBe(404)
	})

	it("keeps the server's error text and status for other HTTP errors", async () => {
		answer = { kind: "error", status: 500, body: { error: "llama runner process has terminated" } }

		const { error } = await collect(newHandler().createMessage("s", [{ role: "user", content: "Hi" }]))

		expect(error.message).toBe("llama runner process has terminated")
		expect(error.status).toBe(500)
	})

	it("reports an error line inside the stream", async () => {
		answer = {
			kind: "ndjson",
			chunks: [ndjson([streamLines[1], { error: "model ran out of memory" }])],
		}

		const { chunks, error } = await collect(newHandler().createMessage("s", [{ role: "user", content: "Hi" }]))

		expect(chunks).toEqual([{ type: "text", text: "Hello" }])
		expect(error.message).toBe("Ollama stream processing error: model ran out of memory")
	})

	it("aborting the task mid-stream aborts the SDK's fetch", async () => {
		answer = { kind: "hang-after", first: ndjson([streamLines[1]]) }
		const task = new AbortController()
		const metadata: ApiHandlerCreateMessageMetadata = { taskId: "task-1", signal: task.signal }
		const stream = newHandler().createMessage("s", [{ role: "user", content: "Hi" }], metadata)

		const first = await stream.next()
		expect(first.value).toEqual({ type: "text", text: "Hello" })
		expect(requests[0].signal?.aborted).toBe(false)

		task.abort()
		const { error } = await collect({ [Symbol.asyncIterator]: () => stream })

		expect(requests[0].signal?.aborted).toBe(true)
		expect(error.message).toBe("Ollama stream processing error: This operation was aborted")
	})

	it("aborting before the answer rejects at once and aborts the late answer on arrival", async () => {
		answer = { kind: "late", chunks: [ndjson(streamLines)] }
		const task = new AbortController()
		const done = collect(
			newHandler().createMessage("s", [{ role: "user", content: "Hi" }], {
				taskId: "task-1",
				signal: task.signal,
			}),
		)
		await vi.waitFor(() => expect(requests).toHaveLength(1))

		task.abort()
		const { chunks, error } = await done
		expect(chunks).toEqual([])
		expect(error.message).toBe("Request was aborted.")
		expect(requests[0].signal?.aborted).toBe(false)

		release()
		await vi.waitFor(() => expect(requests[0].signal?.aborted).toBe(true))
	})

	// ollama 0.5.x decoded every network chunk on its own (TextDecoder without
	// `stream: true`), so a multi-byte character split between two chunks became
	// two U+FFFD replacement characters. Local servers answer in Polish, Chinese or
	// with emoji, and the split happens wherever the TCP segment ends. 0.6.x fixes it.
	it("keeps a multi-byte character that is split between two network chunks", async () => {
		const line = ndjson([
			{ model: "llama3.1", created_at: "t", message: { role: "assistant", content: "Zażółć 🙂" }, done: false },
			streamLines[4],
		])
		const text = new TextDecoder().decode(line)
		// Cut inside the two-byte "ż" (0xC5 0xBC).
		const cut = encoder.encode(text.slice(0, text.indexOf("ż"))).length + 1
		answer = { kind: "ndjson", chunks: [line.slice(0, cut), line.slice(cut)] }

		const { chunks, error } = await collect(newHandler().createMessage("s", [{ role: "user", content: "Hi" }]))

		expect(error).toBeUndefined()
		expect(chunks[0]).toEqual({ type: "text", text: "Zażółć 🙂" })
	})
})
