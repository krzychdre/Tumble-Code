// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.request-signal.spec.ts

// API-5: the task hands the provider the signal of its per-request abort controller in the
// request metadata, so Stop (TaskLifecycle.cancelCurrentRequest) aborts the HTTP request
// itself. Before this the loop only stopped reading the stream and the server kept generating
// (tokens billed, a local GPU busy until the answer was complete).

import { TaskApiLoop } from "../TaskApiLoop"
import { TaskLifecycle } from "../TaskLifecycle"
import type { ApiHandlerCreateMessageMetadata } from "../../../api"
import { logger } from "../../../utils/logging"

function makeTask() {
	const createMessage = vi.fn(async function* (
		_systemPrompt: string,
		_messages: unknown[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	) {
		yield { type: "text" as const, text: "partial answer" }
		// The rest of the answer never arrives: the server is still generating.
		await new Promise(() => {})
	})
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		apiConfiguration: { apiProvider: "anthropic" },
		api: {
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
			countTokens: vi.fn().mockResolvedValue(0),
			createMessage,
			cancelRequest: vi.fn(),
		},
		apiConversationHistory: [],
		clineMessages: [],
		microcompactStrippedTokens: 0,
		skipPrevResponseIdOnce: false,
		providerRef: { deref: () => ({ getState: async () => ({}) }) },
		getTaskMode: async () => "code",
		getTokenUsage: () => ({ contextTokens: 0 }),
		combineMessages: (messages: unknown[]) => messages,
		autoApprovalHandler: { checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }) },
		askSay: { ask: vi.fn(), say: vi.fn() },
	}
	const loop = new TaskApiLoop(access)
	vi.spyOn(loop, "getSystemPrompt").mockResolvedValue("system prompt")
	vi.spyOn((loop as any).retryHandler, "maybeWaitForProviderRateLimit").mockResolvedValue(undefined)
	vi.spyOn(loop as any, "buildToolsArray").mockResolvedValue({ allTools: [], allowedFunctionNames: undefined })
	return { loop, access, createMessage }
}

describe("TaskApiLoop request signal (API-5)", () => {
	beforeEach(() => {
		vi.spyOn(logger, "info").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("passes the signal of the task's request controller to createMessage", async () => {
		const { loop, access, createMessage } = makeTask()

		const stream = loop.attemptApiRequest()
		const first = await stream.next()

		expect(first.value).toEqual({ type: "text", text: "partial answer" })
		expect(createMessage).toHaveBeenCalledTimes(1)
		const metadata = createMessage.mock.calls[0][2]
		expect(metadata?.signal).toBeInstanceOf(AbortSignal)
		expect(metadata?.signal).toBe(access.currentRequestAbortController.signal)
		expect(metadata?.signal?.aborted).toBe(false)
	})

	it("aborts that signal when the user stops the task", async () => {
		const { loop, access, createMessage } = makeTask()

		const stream = loop.attemptApiRequest()
		await stream.next()
		const signal = createMessage.mock.calls[0][2]?.signal

		// What the Stop button runs: ClineProvider.cancelTask -> Task.cancelCurrentRequest(true).
		new TaskLifecycle(access).cancelCurrentRequest(true)

		expect(signal?.aborted).toBe(true)
		// The client-destroy behavior is still requested from the provider.
		expect(access.api.cancelRequest).toHaveBeenCalledWith(true)
	})

	// R3: the first chunk used a hand-written race whose abort listener stayed on the signal for the whole
	// stream. It now goes through raceNextChunkWithAbort, which removes its listener once the chunk arrives.
	it("leaves no first-chunk abort listener on the signal once the first chunk has arrived", async () => {
		const live = new Map<EventListenerOrEventListenerObject, AbortSignal>()
		const add = AbortSignal.prototype.addEventListener
		const remove = AbortSignal.prototype.removeEventListener
		vi.spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(function (
			this: AbortSignal,
			type: string,
			listener: any,
			options?: any,
		) {
			if (type === "abort") live.set(listener, this)
			return add.call(this, type, listener, options)
		})
		vi.spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(function (
			this: AbortSignal,
			type: string,
			listener: any,
			options?: any,
		) {
			if (type === "abort") live.delete(listener)
			return remove.call(this, type, listener, options)
		})
		const { loop, access } = makeTask()

		const stream = loop.attemptApiRequest()
		await stream.next()

		const signal = access.currentRequestAbortController.signal
		const onSignal = [...live.values()].filter((owner) => owner === signal)
		// Only the one-shot logging listener remains.
		expect(onSignal).toHaveLength(1)
	})

	it("still rejects the first chunk when the user stops before it arrives", async () => {
		const createMessage = vi.fn(async function* () {
			// The first chunk never arrives.
			await new Promise(() => {})
			yield { type: "text" as const, text: "never" }
		})
		const { loop, access } = makeTask()
		access.api.createMessage = createMessage
		// S3: the first-chunk error dispatch lives on RetryHandler; the loop
		// calls it with a callback that re-enters attemptApiRequest.
		const handleError = vi
			.spyOn((loop as any).retryHandler, "handleApiRequestError")
			.mockImplementation(async function* (error: unknown) {
				yield { type: "text", text: `handled: ${(error as Error).message}` }
			})

		const stream = loop.attemptApiRequest()
		const pending = stream.next()
		await vi.waitFor(() => expect(createMessage).toHaveBeenCalled())
		access.currentRequestAbortController.abort()

		expect((await pending).value).toEqual({ type: "text", text: "handled: Request cancelled by user" })
		expect(handleError).toHaveBeenCalledTimes(1)
	})
})
