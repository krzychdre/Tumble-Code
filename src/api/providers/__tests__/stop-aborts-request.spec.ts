// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/stop-aborts-request.spec.ts

// Pressing Stop reaches a provider through `cancelRequest()` (TaskLifecycle.cancelCurrentRequest
// calls `api.cancelRequest(destroyClient)`). That only helps when the handler handed the SDK the
// signal of the controller that `cancelRequest()` aborts. These specs pin, for each handler, that
// the SDK call receives a signal and that cancelling ends the stream without a second request.
// The SDK mock behaves like the real one: a pending request or a pending read rejects with an
// abort error once its signal fires, and hangs forever when it was given no signal.

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

const mockChatCreate = vitest.fn()
const mockResponsesCreate = vitest.fn()

vitest.mock("openai", () => ({
	__esModule: true,
	default: vitest.fn().mockImplementation(function () {
		return {
			chat: { completions: { create: mockChatCreate } },
			responses: { create: mockResponsesCreate },
		}
	}),
}))

import { ZAiHandler } from "../zai"
import { DeepSeekHandler } from "../deepseek"
import { OpenAiNativeHandler } from "../openai-native"
import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import type { ApiHandler } from "../../index"
import type { ApiStream } from "../../transform/stream"

/**
 * What the Stop button does to the handler: ClineProvider.cancelTask calls
 * task.cancelCurrentRequest(true), which calls api.cancelRequest?.(true).
 */
function pressStop(handler: ApiHandler) {
	handler.cancelRequest?.(true)
}

class FakeAbortError extends Error {
	constructor() {
		super("Request was aborted.")
		this.name = "AbortError"
	}
}

/** Resolves when the signal fires with a rejection, never settles without a signal. */
function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
	return new Promise<never>((_, reject) => {
		if (!signal) return
		if (signal.aborted) return reject(new FakeAbortError())
		signal.addEventListener("abort", () => reject(new FakeAbortError()), { once: true })
	})
}

/** An SDK stream that emits `first`, then waits for the next chunk until aborted. */
function streamThatWaits(first: unknown, signal: AbortSignal | undefined): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]() {
			let sent = false
			return {
				next: async () => {
					if (!sent) {
						sent = true
						return { done: false, value: first }
					}
					return waitForAbort(signal)
				},
			}
		},
	}
}

type Settled = { status: "rejected"; error: unknown } | { status: "resolved"; value: unknown } | { status: "hung" }

/** Waits briefly for a promise; "hung" means it never settled (the request kept running). */
async function settleWithin(promise: Promise<unknown>, ms = 300): Promise<Settled> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<Settled>((resolve) => {
		timer = setTimeout(() => resolve({ status: "hung" }), ms)
	})
	try {
		return await Promise.race([
			promise.then(
				(value): Settled => ({ status: "resolved", value }),
				(error): Settled => ({ status: "rejected", error }),
			),
			hung,
		])
	} finally {
		clearTimeout(timer)
	}
}

/** The stream stopped: it either rejected or reported done, it did not keep waiting. */
function expectStreamStopped(result: Settled) {
	expect(result.status).not.toBe("hung")
	if (result.status === "resolved") {
		expect((result.value as IteratorResult<unknown>).done).toBe(true)
	}
}

const chatChunk = { choices: [{ delta: { content: "partial answer" }, index: 0 }] }
const responsesChunk = { type: "response.output_text.delta", delta: "partial answer" }

const mockFetch = vitest.fn()

beforeEach(() => {
	vitest.clearAllMocks()
	// A fallback request after Stop would be a second, unabortable request: it must never happen.
	mockFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => waitForAbort(init?.signal))
	vitest.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
	vitest.unstubAllGlobals()
})

describe("Stop aborts the HTTP request", () => {
	describe("Z.ai (GLM thinking path)", () => {
		const createHandler = () =>
			// glm-5.3 always reasons, so this goes through createStreamWithThinking.
			new ZAiHandler({ apiModelId: "glm-5.3", zaiApiKey: "key", zaiApiLine: "international_coding" })

		it("passes an AbortSignal to chat.completions.create", async () => {
			mockChatCreate.mockImplementation((_params, opts) => streamThatWaits(chatChunk, opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			await iterator.next()

			expect(mockChatCreate).toHaveBeenCalledTimes(1)
			expect(mockChatCreate.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
		})

		it("cancelRequest() ends a stream that is waiting for the next chunk", async () => {
			mockChatCreate.mockImplementation((_params, opts) => streamThatWaits(chatChunk, opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			const first = await iterator.next()
			expect(first.done).toBe(false)

			pressStop(handler)

			expectStreamStopped(await settleWithin(iterator.next()))
			expect(mockChatCreate).toHaveBeenCalledTimes(1)
		})
	})

	describe("DeepSeek", () => {
		const createHandler = () => new DeepSeekHandler({ apiModelId: "deepseek-chat", deepSeekApiKey: "key" })

		it("passes an AbortSignal to chat.completions.create", async () => {
			mockChatCreate.mockImplementation(async (_params, opts) => streamThatWaits(chatChunk, opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			await iterator.next()

			expect(mockChatCreate).toHaveBeenCalledTimes(1)
			expect(mockChatCreate.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
		})

		it("cancelRequest() ends a stream that is waiting for the next chunk", async () => {
			mockChatCreate.mockImplementation(async (_params, opts) => streamThatWaits(chatChunk, opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			const first = await iterator.next()
			expect(first.done).toBe(false)

			pressStop(handler)

			expectStreamStopped(await settleWithin(iterator.next()))
			expect(mockChatCreate).toHaveBeenCalledTimes(1)
		})
	})

	describe("OpenAI native (Responses API)", () => {
		const createHandler = () => new OpenAiNativeHandler({ apiModelId: "gpt-4.1", openAiNativeApiKey: "key" })

		it("passes an AbortSignal to responses.create", async () => {
			mockResponsesCreate.mockImplementation(async (_body, opts) => streamThatWaits(responsesChunk, opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			await iterator.next()

			expect(mockResponsesCreate.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
		})

		it("cancelRequest() ends a stream that is waiting for the next event, without a fallback request", async () => {
			mockResponsesCreate.mockImplementation(async (_body, opts) => streamThatWaits(responsesChunk, opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			const first = await iterator.next()
			expect(first.done).toBe(false)

			pressStop(handler)

			expectStreamStopped(await settleWithin(iterator.next()))
			expect(mockResponsesCreate).toHaveBeenCalledTimes(1)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("cancelRequest() before the first event does not fall back to a second request", async () => {
			// The request is still waiting for the server (the model is thinking).
			mockResponsesCreate.mockImplementation((_body, opts) => waitForAbort(opts?.signal))
			const handler = createHandler()

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			const pending = iterator.next()
			await vitest.waitFor(() => expect(mockResponsesCreate).toHaveBeenCalledTimes(1))

			pressStop(handler)

			expectStreamStopped(await settleWithin(pending))
			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("OpenAI Codex (ChatGPT subscription)", () => {
		function createHandler(create: (body: unknown, opts?: { signal?: AbortSignal }) => unknown) {
			const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
			vitest.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
			vitest.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
			const createSpy = vitest.fn(create)
			Reflect.set(handler, "client", { responses: { create: createSpy } })
			return { handler, createSpy }
		}

		it("passes an AbortSignal to responses.create", async () => {
			const { handler, createSpy } = createHandler(async (_body, opts) =>
				streamThatWaits(responsesChunk, opts?.signal),
			)

			const iterator: ApiStream = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			await iterator.next()

			expect(createSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
		})

		it("cancelRequest() ends a stream that is waiting for the next event", async () => {
			const { handler, createSpy } = createHandler(async (_body, opts) =>
				streamThatWaits(responsesChunk, opts?.signal),
			)

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			const first = await iterator.next()
			expect(first.done).toBe(false)

			pressStop(handler)

			expectStreamStopped(await settleWithin(iterator.next()))
			expect(createSpy).toHaveBeenCalledTimes(1)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("cancelRequest() before the first event does not fall back to a second request", async () => {
			const { handler, createSpy } = createHandler((_body, opts) => waitForAbort(opts?.signal))

			const iterator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
			const pending = iterator.next()
			await vitest.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))

			pressStop(handler)

			expectStreamStopped(await settleWithin(pending))
			expect(createSpy).toHaveBeenCalledTimes(1)
			expect(mockFetch).not.toHaveBeenCalled()
		})
	})
})
