// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.no-auto-retry-auth-errors.spec.ts

// Owner decision 14 (2026-09-25): with auto-approve on, the task loop used to
// retry EVERY failed API request with backoff. 401 (bad key), 403 (forbidden)
// and 404 (unknown model or endpoint) never fix themselves, so the task looped
// forever. Those three now surface the failure (the `api_req_failed` ask the
// user answers with Retry), everything else (400 included: Z.ai and some
// proxies return it for transient trouble) keeps the automatic retry.

import { TaskApiLoop } from "../TaskApiLoop"

function apiError(status: number | undefined): Error {
	const error = new Error(status === undefined ? "socket hang up" : `Provider error ${status}`)
	if (status !== undefined) (error as any).status = status
	return error
}

function makeLoop(failure: Error, autoApprovalEnabled = true) {
	let calls = 0
	const createMessage = vi.fn(async function* () {
		calls++
		if (calls === 1) throw failure
		yield { type: "text" as const, text: "recovered" }
	})
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		abandoned: false,
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
		providerRef: { deref: () => ({ getState: async () => ({ autoApprovalEnabled }) }) },
		getTaskMode: async () => "code",
		getTokenUsage: () => ({ contextTokens: 0 }),
		combineMessages: (messages: unknown[]) => messages,
		autoApprovalHandler: { checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }) },
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "noButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		},
		abortTask: vi.fn(),
	}
	const loop = new TaskApiLoop(access)
	vi.spyOn(loop, "getSystemPrompt").mockResolvedValue("system prompt")
	vi.spyOn(loop, "maybeWaitForProviderRateLimit").mockResolvedValue(undefined)
	vi.spyOn(loop as any, "buildToolsArray").mockResolvedValue({ allTools: [], allowedFunctionNames: undefined })
	const backoff = vi.spyOn(loop, "backoffAndAnnounce").mockResolvedValue(undefined)
	return { loop, access, createMessage, backoff }
}

async function drain(stream: AsyncGenerator<any>): Promise<{ chunks: any[]; thrown?: unknown }> {
	const chunks: any[] = []
	try {
		for await (const chunk of stream) chunks.push(chunk)
	} catch (thrown) {
		return { chunks, thrown }
	}
	return { chunks }
}

describe("TaskApiLoop: no automatic retry for 401, 403 and 404", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("first-chunk failure with auto-approve on", () => {
		it.each([401, 403, 404])("status %s: no backoff, no retry, the failure is surfaced as api_req_failed", async (status) => {
			const failure = apiError(status)
			const { loop, access, createMessage, backoff } = makeLoop(failure)

			const { chunks, thrown } = await drain(loop.attemptApiRequest())

			expect(backoff).not.toHaveBeenCalled()
			expect(createMessage).toHaveBeenCalledTimes(1)
			expect(access.askSay.ask).toHaveBeenCalledWith("api_req_failed", failure.message)
			// The user declined the manual retry: the request fails like the non-auto-approve path.
			expect(chunks).toEqual([])
			expect((thrown as Error).message).toBe("API request failed")
		})

		it("status 401: the user's manual Retry sends the request again", async () => {
			const { loop, access, createMessage, backoff } = makeLoop(apiError(401))
			access.askSay.ask.mockResolvedValueOnce({ response: "yesButtonClicked" })

			const { chunks, thrown } = await drain(loop.attemptApiRequest())

			expect(thrown).toBeUndefined()
			expect(backoff).not.toHaveBeenCalled()
			expect(access.askSay.say).toHaveBeenCalledWith("api_req_retried")
			expect(createMessage).toHaveBeenCalledTimes(2)
			expect(chunks).toEqual([{ type: "text", text: "recovered" }])
		})

		it.each([
			["400", 400],
			["429", 429],
			["500", 500],
			["no status", undefined],
		])("%s: backs off and retries automatically as before", async (_label, status) => {
			const failure = apiError(status)
			const { loop, access, createMessage, backoff } = makeLoop(failure)

			const { chunks, thrown } = await drain(loop.attemptApiRequest())

			expect(thrown).toBeUndefined()
			expect(backoff).toHaveBeenCalledTimes(1)
			expect(backoff).toHaveBeenCalledWith(0, failure)
			expect(access.askSay.ask).not.toHaveBeenCalledWith("api_req_failed", expect.anything())
			expect(createMessage).toHaveBeenCalledTimes(2)
			expect(chunks).toEqual([{ type: "text", text: "recovered" }])
		})

		it("reads the status under the other SDK names too (statusCode, status_code, $metadata)", async () => {
			const variants = [
				Object.assign(new Error("mistral"), { statusCode: 401 }),
				Object.assign(new Error("ollama"), { status_code: 404 }),
				Object.assign(new Error("bedrock"), { $metadata: { httpStatusCode: 403 } }),
			]
			for (const failure of variants) {
				const { loop, backoff, createMessage } = makeLoop(failure)
				await drain(loop.attemptApiRequest())
				expect(backoff).not.toHaveBeenCalled()
				expect(createMessage).toHaveBeenCalledTimes(1)
			}
		})
	})

	it("a background task keeps the backoff retry for 401 (nobody watches its asks)", async () => {
		const failure = apiError(401)
		const { loop, access, createMessage, backoff } = makeLoop(failure)
		access.isBackground = true

		const { chunks } = await drain(loop.attemptApiRequest())

		expect(backoff).toHaveBeenCalledWith(0, failure)
		expect(access.askSay.ask).not.toHaveBeenCalledWith("api_req_failed", expect.anything())
		expect(createMessage).toHaveBeenCalledTimes(2)
		expect(chunks).toEqual([{ type: "text", text: "recovered" }])
	})

	describe("mid-stream failure with auto-approve on", () => {
		function midStream(status: number | undefined, answer: "yesButtonClicked" | "noButtonClicked") {
			const failure = apiError(status)
			const { loop, access, backoff } = makeLoop(failure)
			access.askSay.ask.mockResolvedValue({ response: answer })
			const abortStream = vi.fn().mockResolvedValue(undefined)
			const stack: any[] = []
			const run = () =>
				(loop as any).handleStreamError(failure, abortStream, { retryAttempt: 2 }, [], stack) as Promise<string>
			return { run, access, backoff, stack, failure }
		}

		it.each([401, 403, 404])("status %s: no backoff, asks api_req_failed; declining stops the loop", async (status) => {
			const { run, access, backoff, stack, failure } = midStream(status, "noButtonClicked")

			const result = await run()

			expect(backoff).not.toHaveBeenCalled()
			expect(access.askSay.ask).toHaveBeenCalledWith("api_req_failed", failure.message)
			expect(stack).toEqual([])
			expect(result).toBe("return_true")
		})

		it("status 401: the user's manual Retry queues the request again", async () => {
			const { run, access, backoff, stack } = midStream(401, "yesButtonClicked")

			const result = await run()

			expect(backoff).not.toHaveBeenCalled()
			expect(access.askSay.say).toHaveBeenCalledWith("api_req_retried")
			expect(stack).toHaveLength(1)
			expect(stack[0].retryAttempt).toBe(3)
			expect(result).toBe("continue")
		})

		it.each([
			["400", 400],
			["429", 429],
			["500", 500],
			["no status", undefined],
		])("%s: backs off and retries automatically as before", async (_label, status) => {
			const { run, access, backoff, stack, failure } = midStream(status, "noButtonClicked")

			const result = await run()

			expect(backoff).toHaveBeenCalledWith(2, failure)
			expect(access.askSay.ask).not.toHaveBeenCalled()
			expect(stack).toHaveLength(1)
			expect(result).toBe("continue")
		})
	})
})
