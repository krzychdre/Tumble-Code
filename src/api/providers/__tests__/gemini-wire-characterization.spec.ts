// Characterization of the Gemini and Vertex (Gemini) handlers against the REAL
// @google/genai client: only `fetch` is faked. The other Gemini specs replace
// `client.models.*`, so nothing else notices when an SDK upgrade changes the
// request on the wire, the parsing of the SSE stream, the error shape or how
// Vertex credentials reach google-auth-library. Written before DEP-6 (SDK 1.x
// to 2.x) and expected to pass unchanged on both majors.

import { createRequire } from "node:module"

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
import { GeminiHandler } from "../gemini"
import { VertexHandler } from "../vertex"

// google-auth-library as the SDK itself resolves it (the SDK depends on its own
// major, which is not necessarily the one `src` declares).
const sdkRequire = createRequire(require.resolve("@google/genai"))
const { GoogleAuth } = sdkRequire("google-auth-library") as typeof import("google-auth-library")

type RecordedRequest = {
	url: string
	method: string | undefined
	headers: Record<string, string>
	body: unknown
	signal: AbortSignal | undefined
}

// The version numbers in these headers change with every SDK release.
const VERSIONED_HEADERS = new Set(["user-agent", "x-goog-api-client"])

const streamChunks = [
	{
		candidates: [{ content: { role: "model", parts: [{ text: "Let me think.", thought: true }] } }],
		responseId: "resp-1",
	},
	{
		candidates: [
			{ content: { role: "model", parts: [{ text: "Reading it now.", thoughtSignature: "c2lnLTE=" }] } },
		],
		responseId: "resp-1",
	},
	{
		candidates: [
			{
				content: {
					role: "model",
					parts: [
						{ functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "c2lnLTI=" },
					],
				},
				finishReason: "STOP",
				groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/doc", title: "Doc" } }] },
			},
		],
		usageMetadata: {
			promptTokenCount: 1200,
			candidatesTokenCount: 30,
			cachedContentTokenCount: 800,
			thoughtsTokenCount: 12,
			totalTokenCount: 1242,
		},
		responseId: "resp-1",
	},
]

const unaryResponse = {
	candidates: [{ content: { role: "model", parts: [{ text: "Summary." }] }, finishReason: "STOP" }],
	usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5, cachedContentTokenCount: 10, totalTokenCount: 55 },
}

let requests: RecordedRequest[]
let respondWith: "ok" | 429

function sseBody(chunks: unknown[]): string {
	return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("")
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const headers: Record<string, string> = {}
	new Headers(init?.headers).forEach((value, key) => {
		headers[key] = VERSIONED_HEADERS.has(key) ? "<versioned>" : value
	})
	const url = String(input)
	requests.push({
		url,
		method: init?.method,
		headers,
		body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
		signal: init?.signal ?? undefined,
	})

	if (init?.signal?.aborted) {
		throw new DOMException("This operation was aborted", "AbortError")
	}

	if (respondWith === 429) {
		return new Response(
			JSON.stringify({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } }),
			{ status: 429, headers: { "content-type": "application/json" } },
		)
	}

	if (url.includes(":streamGenerateContent")) {
		return new Response(sseBody(streamChunks), { status: 200, headers: { "content-type": "text/event-stream" } })
	}

	return new Response(JSON.stringify(unaryResponse), { status: 200, headers: { "content-type": "application/json" } })
}

const history: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "Open a.ts" },
	{
		role: "assistant",
		content: [
			{ type: "thoughtSignature", thoughtSignature: "cHJldi1zaWc=" } as any,
			{ type: "text", text: "Opening." },
			{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "a.ts" } },
		],
	},
	{
		role: "user",
		content: [{ type: "tool_result", tool_use_id: "call-1", content: "export const a = 1" }],
	},
]

const tools = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file",
			parameters: {
				$schema: "http://json-schema.org/draft-07/schema#",
				type: "object",
				properties: { path: { type: ["string", "null"], description: "File path" } },
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
	return {
		taskId: "task-1",
		tools,
		tool_choice: { type: "function", function: { name: "read_file" } } as any,
		...(signal ? { signal } : {}),
	}
}

describe("Gemini handlers against the real @google/genai client (wire characterization)", () => {
	beforeEach(() => {
		requests = []
		respondWith = "ok"
		mockCaptureException.mockClear()
		vi.stubGlobal("fetch", vi.fn(fakeFetch))
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	describe("Gemini API (API key)", () => {
		const options = {
			geminiApiKey: "test-key",
			apiModelId: "gemini-3-pro-preview",
			reasoningEffort: "low" as const,
		}

		it("sends the same streamGenerateContent request", async () => {
			const controller = new AbortController()
			const handler = new GeminiHandler(options)

			await collect(handler.createMessage("You are helpful.", history, metadata(controller.signal)))

			expect(requests).toHaveLength(1)
			const [request] = requests
			expect(request.url).toBe(
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent?alt=sse",
			)
			expect(request.method).toBe("POST")
			expect(request.headers).toEqual({
				"content-type": "application/json",
				"user-agent": "<versioned>",
				"x-goog-api-client": "<versioned>",
				"x-goog-api-key": "test-key",
			})
			// The task signal reaches fetch (API-5), wrapped or not.
			expect(request.signal).toBeInstanceOf(AbortSignal)
			expect(request.body).toMatchSnapshot()
		})

		it("keeps the lowercase thinking level on the wire", async () => {
			const handler = new GeminiHandler(options)

			await collect(handler.createMessage("sys", history, metadata()))

			expect((requests[0].body as any).generationConfig.thinkingConfig).toEqual({
				thinkingLevel: "low",
				includeThoughts: true,
			})
		})

		it("parses thoughts, text, function calls, grounding and usage (incl. cached tokens) the same way", async () => {
			const handler = new GeminiHandler(options)

			const chunks = await collect(handler.createMessage("sys", history, metadata()))

			expect(chunks).toEqual([
				{ type: "reasoning", text: "Let me think." },
				{ type: "text", text: "Reading it now." },
				{ type: "tool_call_partial", index: 0, id: "read_file-0", name: "read_file", arguments: undefined },
				{
					type: "tool_call_partial",
					index: 0,
					id: "read_file-0",
					name: undefined,
					arguments: '{"path":"a.ts"}',
				},
				{ type: "grounding", sources: [{ title: "Doc", url: "https://example.com/doc" }] },
				{
					type: "usage",
					inputTokens: 1200,
					outputTokens: 30,
					cacheReadTokens: 800,
					reasoningTokens: 12,
					totalCost: expect.any(Number),
				},
			])
			// The last thought signature and the response id are kept for api_history.
			expect(handler.getThoughtSignature()).toBe("c2lnLTI=")
			expect(handler.getResponseId()).toBe("resp-1")
		})

		it("sends the same generateContent request for completePrompt and reads its usage", async () => {
			const handler = new GeminiHandler({ geminiApiKey: "test-key", apiModelId: "gemini-2.5-flash" })

			const result = await handler.completePromptWithUsage("Summarize")

			expect(result.text).toBe("Summary.")
			expect(result.usage).toMatchSnapshot()
			expect(requests[0].url).toBe(
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
			)
			expect(requests[0].body).toMatchSnapshot()
		})

		it("honors the custom base URL", async () => {
			const handler = new GeminiHandler({ ...options, googleGeminiBaseUrl: "https://proxy.example.com/" })

			await collect(handler.createMessage("sys", history, metadata()))

			expect(requests[0].url).toBe(
				"https://proxy.example.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent?alt=sse",
			)
		})

		it("surfaces an HTTP 429 with its status (error contract)", async () => {
			respondWith = 429
			const handler = new GeminiHandler(options)

			const error = await collect(handler.createMessage("sys", history, metadata())).then(
				() => undefined,
				(e: unknown) => e as { status?: number; message?: string },
			)

			expect(error?.status).toBe(429)
			// The SDK's ApiError message (the JSON error body) reaches telemetry.
			expect(mockCaptureException.mock.calls[0][0].message).toContain("Resource exhausted")
			// The SDK does not retry on its own (retries are TaskApiLoop's job).
			expect(requests).toHaveLength(1)
		})

		// Stop can land between the per-request controller's creation and the SDK
		// call (`createRequestAbortController` then returns an aborted controller).
		// SDK 1.x only listened for a later 'abort' event, so an already-aborted
		// signal sent the request anyway and streamed the whole answer.
		it("rejects without a response when the task signal is already aborted", async () => {
			const controller = new AbortController()
			controller.abort()
			const handler = new GeminiHandler(options)

			await expect(collect(handler.createMessage("sys", history, metadata(controller.signal)))).rejects.toThrow()
			expect(requests.every((request) => request.signal?.aborted)).toBe(true)
		})
	})

	describe("Vertex AI (Gemini)", () => {
		function spyOnAuth() {
			const instances: Array<{ jsonContent: unknown; keyFilename: unknown; scopes: unknown }> = []
			vi.spyOn(GoogleAuth.prototype, "getRequestHeaders").mockImplementation(async function (this: any) {
				instances.push({ jsonContent: this.jsonContent, keyFilename: this.keyFilename, scopes: this.scopes })
				return new Headers({ authorization: "Bearer vertex-token" }) as any
			})
			return instances
		}

		const vertexOptions = {
			vertexProjectId: "my-project",
			vertexRegion: "us-central1",
			apiModelId: "gemini-2.5-pro",
		}

		it.each([
			["JSON key", { vertexJsonCredentials: JSON.stringify({ type: "service_account", client_email: "a@b.c" }) }],
			["key file", { vertexKeyFile: "/keys/sa.json" }],
			["application default credentials", {}],
		])("sends the same request and hands the %s to google-auth-library", async (_name, credentials) => {
			const auth = spyOnAuth()
			const handler = new VertexHandler({ ...vertexOptions, ...credentials })

			await collect(handler.createMessage("sys", history, metadata()))

			expect(requests).toHaveLength(1)
			expect(requests[0].url).toBe(
				"https://us-central1-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
			)
			expect(requests[0].headers).toEqual({
				authorization: "Bearer vertex-token",
				"content-type": "application/json",
				"user-agent": "<versioned>",
				"x-goog-api-client": "<versioned>",
			})
			expect(auth).toMatchSnapshot()
			expect(requests[0].body).toMatchSnapshot()
		})
	})
})
