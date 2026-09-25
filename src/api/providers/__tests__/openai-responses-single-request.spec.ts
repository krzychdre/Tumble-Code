// npx vitest run api/providers/__tests__/openai-responses-single-request.spec.ts

// DEF-C44: when the OpenAI SDK request fails, OpenAI Native and OpenAI Codex fall back to a
// hand-written fetch of the same Responses API request. That fallback exists for an SDK that
// cannot stream the Responses API at all (it was added when the SDK had no `responses`). It
// must never re-send a request the server already answered (429, 401, 5xx) or already
// started to answer: the server would get it twice.
//
// These specs drive the REAL openai SDK against one fake server (the SDK's `fetch` option and
// the global fetch of the SSE fallback both point at it) and count what reaches the server.

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

import OpenAI from "openai"
import type { Anthropic } from "@anthropic-ai/sdk"

import { OpenAiNativeHandler } from "../openai-native"
import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"

const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

type FakeServer = ((input: unknown, init?: unknown) => Promise<Response>) & { requests: number }

function fakeServer(answer: () => Response): FakeServer {
	const server = (async () => {
		server.requests++
		return answer()
	}) as FakeServer
	server.requests = 0
	return server
}

function jsonError(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: { message, type: "error", code: null } }), {
		status,
		headers: { "Content-Type": "application/json" },
	})
}

function sseEvent(event: unknown): string {
	return `data: ${JSON.stringify(event)}\n\n`
}

/** An SSE answer that sends one text delta and then breaks off (the connection drops). */
function brokenStream(): Response {
	let sent = false
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (!sent) {
				sent = true
				controller.enqueue(new TextEncoder().encode(sseEvent({ type: "response.output_text.delta", delta: "Hi" })))
				return
			}
			controller.error(new Error("socket hang up"))
		},
	})
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function completeStream(): Response {
	const body =
		sseEvent({ type: "response.output_text.delta", delta: "Hi there" }) +
		sseEvent({
			type: "response.completed",
			response: { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 3, output_tokens: 2 } },
		})
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/**
 * A real SDK client that talks to the fake server. maxRetries 0 keeps the SDK's own retry
 * policy (a separate setting) out of the count: every extra request counted here is a re-send
 * by the handler.
 */
function realClient(server: FakeServer, baseURL: string): OpenAI {
	return new OpenAI({ apiKey: "test-key", baseURL, maxRetries: 0, fetch: server as unknown as typeof fetch })
}

async function drain(stream: AsyncIterable<any>): Promise<{ chunks: any[]; error: any }> {
	const chunks: any[] = []
	try {
		for await (const chunk of stream) {
			chunks.push(chunk)
		}
		return { chunks, error: undefined }
	} catch (error) {
		return { chunks, error }
	}
}

afterEach(() => {
	vitest.restoreAllMocks()
	vitest.unstubAllGlobals()
})

describe("OpenAiNativeHandler sends a request once (DEF-C44)", () => {
	function nativeHandler(server: FakeServer, client: unknown = realClient(server, "http://fake.test/v1")) {
		const handler = new OpenAiNativeHandler({
			apiModelId: "gpt-4.1",
			openAiNativeApiKey: "test-key",
			openAiNativeBaseUrl: "http://fake.test",
		})
		Reflect.set(handler, "client", client)
		vitest.stubGlobal("fetch", server)
		return handler
	}

	it.each([
		[429, "Rate limit reached"],
		[401, "Incorrect API key provided"],
		[500, "The server had an error"],
	])("an HTTP %i answer reaches the server exactly once and keeps its status", async (status, message) => {
		const server = fakeServer(() => jsonError(status, message))
		const handler = nativeHandler(server)

		const { error } = await drain(handler.createMessage("System", messages))

		expect(server.requests).toBe(1)
		expect(error).toBeDefined()
		expect(error.status).toBe(status)
	})

	it("a stream that breaks off after output is not sent again", async () => {
		const server = fakeServer(brokenStream)
		const handler = nativeHandler(server)

		const { chunks, error } = await drain(handler.createMessage("System", messages))

		expect(server.requests).toBe(1)
		expect(error).toBeDefined()
		expect(chunks.filter((c) => c.type === "text").map((c) => c.text)).toEqual(["Hi"])
	})

	it("still falls back to the SSE request when the SDK has no Responses API", async () => {
		const server = fakeServer(completeStream)
		// An SDK without `responses` (the reason the fallback exists).
		const handler = nativeHandler(server, {})

		const { chunks, error } = await drain(handler.createMessage("System", messages))

		expect(error).toBeUndefined()
		expect(server.requests).toBe(1)
		expect(chunks.filter((c) => c.type === "text").map((c) => c.text)).toEqual(["Hi there"])
	})
})

describe("OpenAiCodexHandler sends a request once (DEF-C44)", () => {
	function codexHandler(server: FakeServer, client: unknown = realClient(server, "http://fake.test/codex")) {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
		vitest.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vitest.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
		// No new token: the auth retry (a deliberate second request with a NEW token) is not taken.
		vitest.spyOn(openAiCodexOAuthManager, "forceRefreshAccessToken").mockResolvedValue(null)
		Reflect.set(handler, "client", client)
		vitest.stubGlobal("fetch", server)
		return handler
	}

	it.each([
		[429, "Rate limit reached"],
		[401, "Unauthorized"],
		[500, "The server had an error"],
	])("an HTTP %i answer reaches the server exactly once and keeps its status", async (status, message) => {
		const server = fakeServer(() => jsonError(status, message))
		const handler = codexHandler(server)

		const { error } = await drain(handler.createMessage("System", messages))

		expect(server.requests).toBe(1)
		expect(error).toBeDefined()
		expect(error.status).toBe(status)
	})

	it("a 401 is retried once with a refreshed token, never with the same one", async () => {
		const server = fakeServer(() => jsonError(401, "Unauthorized"))
		const handler = codexHandler(server)
		vitest.mocked(openAiCodexOAuthManager.forceRefreshAccessToken).mockResolvedValue("new-token")

		const { error } = await drain(handler.createMessage("System", messages))

		// First attempt with the old token, one retry with the refreshed token.
		expect(server.requests).toBe(2)
		expect(error.status).toBe(401)
	})

	it("still falls back to the SSE request when the SDK has no Responses API", async () => {
		const server = fakeServer(completeStream)
		const handler = codexHandler(server, {})

		const { chunks, error } = await drain(handler.createMessage("System", messages))

		expect(error).toBeUndefined()
		expect(server.requests).toBe(1)
		expect(chunks.filter((c) => c.type === "text").map((c) => c.text)).toEqual(["Hi there"])
	})
})
