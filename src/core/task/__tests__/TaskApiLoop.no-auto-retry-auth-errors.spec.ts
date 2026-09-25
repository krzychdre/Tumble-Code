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

/**
 * Fails more often than the background retry cap, but not forever: an
 * uncapped loop still ends (and the test fails on the call count) instead of
 * recursing until the worker dies.
 */
const FAILS_LONGER_THAN_THE_CAP = 20

function makeLoop(failure: Error, autoApprovalEnabled = true, failures = 1) {
	let calls = 0
	const createMessage = vi.fn(async function* () {
		calls++
		if (calls <= failures) throw failure
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
		it.each([401, 403, 404])(
			"status %s: no backoff, no retry, the failure is surfaced as api_req_failed",
			async (status) => {
				const failure = apiError(status)
				const { loop, access, createMessage, backoff } = makeLoop(failure)

				const { chunks, thrown } = await drain(loop.attemptApiRequest())

				expect(backoff).not.toHaveBeenCalled()
				expect(createMessage).toHaveBeenCalledTimes(1)
				expect(access.askSay.ask).toHaveBeenCalledWith("api_req_failed", failure.message)
				// The user declined the manual retry: the request fails like the non-auto-approve path.
				expect(chunks).toEqual([])
				expect((thrown as Error).message).toBe("API request failed")
			},
		)

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

	// A background task (memory writer, parallel subagent) has nobody to ask:
	// its approval policy answers api_req_failed with an instant approve, so the
	// ask would become a tight loop. For 401, 403 and 404 it fails fast instead:
	// one request, no backoff, no ask, the task ends as streaming_failed and
	// records a short failure message for whoever awaits it.
	describe("background task", () => {
		function backgroundLoop(status: number | undefined, autoApprovalEnabled = true) {
			const failure = apiError(status)
			const made = makeLoop(failure, autoApprovalEnabled)
			made.access.isBackground = true
			made.access.abortTask = vi.fn(async () => {
				made.access.abort = true
			})
			return { ...made, failure }
		}

		it.each([
			[401, true],
			[403, true],
			[404, true],
			[401, false],
		])(
			"first-chunk %s (auto-approve %s): one request, no backoff, no ask, the task ends with a failure message",
			async (status, autoApprovalEnabled) => {
				const { loop, access, createMessage, backoff, failure } = backgroundLoop(status, autoApprovalEnabled)

				const { chunks, thrown } = await drain(loop.attemptApiRequest())

				expect(chunks).toEqual([])
				expect(thrown).toBe(failure)
				expect(createMessage).toHaveBeenCalledTimes(1)
				expect(backoff).not.toHaveBeenCalled()
				expect(access.askSay.ask).not.toHaveBeenCalled()

				// processStream hands the thrown error to handleStreamError.
				const abortStream = vi.fn().mockResolvedValue(undefined)
				const stack: any[] = []
				const result = await (loop as any).handleStreamError(
					thrown,
					abortStream,
					{ retryAttempt: 0 },
					[],
					stack,
				)

				expect(result).toBe("return_true")
				expect(stack).toEqual([])
				expect(backoff).not.toHaveBeenCalled()
				expect(access.askSay.ask).not.toHaveBeenCalled()
				expect(createMessage).toHaveBeenCalledTimes(1)
				expect(abortStream).toHaveBeenCalledWith("streaming_failed", expect.any(String))
				expect(access.abortReason).toBe("streaming_failed")
				expect(access.abortTask).toHaveBeenCalledTimes(1)
				expect(access.apiFailureMessage).toContain(`API error ${status}`)
				expect(access.apiFailureMessage).toContain("anthropic")
				expect(access.apiFailureMessage).toContain("test-model")
				expect(access.apiFailureMessage).toContain(failure.message)
			},
		)

		it("names the reason for each status in the failure message", async () => {
			const reasons: Record<number, string> = {
				401: "invalid or missing API key",
				403: "access forbidden",
				404: "model or endpoint not found",
			}
			for (const [status, reason] of Object.entries(reasons)) {
				const { loop, access, failure } = backgroundLoop(Number(status))
				await (loop as any).handleStreamError(failure, vi.fn(), { retryAttempt: 0 }, [], [])
				expect(access.apiFailureMessage).toContain(reason)
			}
		})

		it.each([401, 403, 404])("mid-stream %s: no backoff, no ask, no requeue, the task ends", async (status) => {
			const { loop, access, backoff, failure } = backgroundLoop(status)
			const stack: any[] = []

			const result = await (loop as any).handleStreamError(failure, vi.fn(), { retryAttempt: 2 }, [], stack)

			expect(result).toBe("return_true")
			expect(stack).toEqual([])
			expect(backoff).not.toHaveBeenCalled()
			expect(access.askSay.ask).not.toHaveBeenCalled()
			expect(access.abortReason).toBe("streaming_failed")
			expect(access.abortTask).toHaveBeenCalledTimes(1)
			expect(access.apiFailureMessage).toContain(`API error ${status}`)
		})

		// Background tasks never reach the api_req_failed ask: their approval
		// policy approves it at once, so with auto-approve off a retryable error
		// used to re-request in a tight loop with no delay.
		it.each([
			["400", 400, true],
			["429", 429, true],
			["500", 500, true],
			["no status", undefined, true],
			["400", 400, false],
			["429", 429, false],
			["500", 500, false],
			["no status", undefined, false],
		])(
			"%s (status %s, auto-approve %s): backs off and retries on both paths, never asks",
			async (_label, status, autoApprovalEnabled) => {
				const first = backgroundLoop(status, autoApprovalEnabled)
				const { chunks, thrown } = await drain(first.loop.attemptApiRequest())
				expect(thrown).toBeUndefined()
				expect(first.backoff).toHaveBeenCalledWith(0, first.failure)
				expect(first.createMessage).toHaveBeenCalledTimes(2)
				expect(chunks).toEqual([{ type: "text", text: "recovered" }])

				const mid = backgroundLoop(status, autoApprovalEnabled)
				const stack: any[] = []
				const result = await (mid.loop as any).handleStreamError(
					mid.failure,
					vi.fn(),
					{ retryAttempt: 2 },
					[],
					stack,
				)
				expect(result).toBe("continue")
				expect(mid.backoff).toHaveBeenCalledWith(2, mid.failure)
				expect(stack).toHaveLength(1)

				for (const run of [first, mid]) {
					expect(run.access.askSay.ask).not.toHaveBeenCalled()
					expect(run.access.abortTask).not.toHaveBeenCalled()
					expect(run.access.apiFailureMessage).toBeUndefined()
				}
			},
		)

		it("an empty model response backs off instead of asking (auto-approve off)", async () => {
			const { loop, access, backoff } = backgroundLoop(500, false)
			access.consecutiveNoAssistantMessagesCount = 0
			access.history = { addToApiConversationHistory: vi.fn().mockResolvedValue(undefined) }
			const stack: any[] = []

			const result = await (loop as any).handleEmptyAssistantResponse({ retryAttempt: 1 }, [], stack)

			expect(result).toBe("continue")
			expect(backoff).toHaveBeenCalledWith(1, expect.any(Error))
			expect(access.askSay.ask).not.toHaveBeenCalled()
			expect(stack).toHaveLength(1)
		})

		// Backoff alone is not a bound: the first-chunk retry recurses inside
		// attemptApiRequest and never counts against maxAgentTurns. After
		// BACKGROUND_MAX_API_RETRIES retries (5+10+20+40+80+160 s = 315 s of
		// backoff at the default 5 s base) the task ends like a 401 does.
		it.each([true, false])(
			"500 on every request (auto-approve %s): 7 requests, 6 backoffs, then the task ends",
			async (autoApprovalEnabled) => {
				const failure = apiError(500)
				const made = makeLoop(failure, autoApprovalEnabled, FAILS_LONGER_THAN_THE_CAP)
				made.access.isBackground = true
				made.access.abortTask = vi.fn(async () => {
					made.access.abort = true
				})

				const { thrown } = await drain(made.loop.attemptApiRequest())

				expect(made.createMessage).toHaveBeenCalledTimes(7)
				expect(made.backoff.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1, 2, 3, 4, 5])
				expect(made.access.askSay.ask).not.toHaveBeenCalled()

				const stack: any[] = []
				const result = await (made.loop as any).handleStreamError(
					thrown,
					vi.fn(),
					{ retryAttempt: 0 },
					[],
					stack,
				)

				expect(result).toBe("return_true")
				expect(stack).toEqual([])
				expect(made.createMessage).toHaveBeenCalledTimes(7)
				expect(made.access.abortReason).toBe("streaming_failed")
				expect(made.access.abortTask).toHaveBeenCalledTimes(1)
				expect(made.access.apiFailureMessage).toContain("API error 500")
				expect(made.access.apiFailureMessage).toContain("anthropic")
				expect(made.access.apiFailureMessage).toContain("after 7 attempts")
				expect(made.access.apiFailureMessage).toContain(failure.message)
			},
		)

		it("mid-stream: a failure at the retry cap ends the task instead of requeueing", async () => {
			const { loop, access, backoff, failure } = backgroundLoop(500, false)
			const stack: any[] = []

			const result = await (loop as any).handleStreamError(failure, vi.fn(), { retryAttempt: 6 }, [], stack)

			expect(result).toBe("return_true")
			expect(stack).toEqual([])
			expect(backoff).not.toHaveBeenCalled()
			expect(access.askSay.ask).not.toHaveBeenCalled()
			expect(access.abortReason).toBe("streaming_failed")
			expect(access.abortTask).toHaveBeenCalledTimes(1)
			expect(access.apiFailureMessage).toContain("API error 500")
			expect(access.apiFailureMessage).toContain("after 7 attempts")
		})

		it("without a status the failure line says the request failed", async () => {
			const { loop, access, failure } = backgroundLoop(undefined, false)

			await (loop as any).handleStreamError(failure, vi.fn(), { retryAttempt: 6 }, [], [])

			expect(access.apiFailureMessage).toMatch(/^API request failed from provider "anthropic"/)
			expect(access.apiFailureMessage).toContain("socket hang up")
		})

		it("fake timers: auto-approve off, 500: requests are spaced by the real backoff", async () => {
			vi.useFakeTimers()
			try {
				const failure = apiError(500)
				const made = makeLoop(failure, false, FAILS_LONGER_THAN_THE_CAP)
				made.access.isBackground = true
				made.backoff.mockRestore()
				made.access.abortTask = vi.fn(async () => {
					made.access.abort = true
				})

				const done = drain(made.loop.attemptApiRequest())
				const callsAfter = async (ms: number) => {
					await vi.advanceTimersByTimeAsync(ms)
					return made.createMessage.mock.calls.length
				}

				expect(await callsAfter(0)).toBe(1)
				expect(await callsAfter(4_900)).toBe(1)
				expect(await callsAfter(200)).toBe(2) // 5 s after the first failure
				expect(await callsAfter(9_800)).toBe(2)
				expect(await callsAfter(200)).toBe(3) // 10 s after the second
				expect(await callsAfter(20_000)).toBe(4) // 20 s after the third
				expect(await callsAfter(40_000 + 80_000 + 160_000)).toBe(7)
				const { thrown } = await done
				expect(made.access.askSay.ask).not.toHaveBeenCalled()

				await (made.loop as any).handleStreamError(thrown, vi.fn(), { retryAttempt: 0 }, [], [])
				expect(made.access.abortTask).toHaveBeenCalledTimes(1)
				expect(made.access.apiFailureMessage).toContain("after 7 attempts")
			} finally {
				vi.useRealTimers()
			}
		})
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

		it.each([401, 403, 404])(
			"status %s: no backoff, asks api_req_failed; declining stops the loop",
			async (status) => {
				const { run, access, backoff, stack, failure } = midStream(status, "noButtonClicked")

				const result = await run()

				expect(backoff).not.toHaveBeenCalled()
				expect(access.askSay.ask).toHaveBeenCalledWith("api_req_failed", failure.message)
				expect(stack).toEqual([])
				expect(result).toBe("return_true")
			},
		)

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

	// Declining the first-chunk ask throws out of attemptApiRequest; processStream
	// hands that error to handleStreamError. It used to be treated as a normal
	// mid-stream failure (no status, so auto-retried or retried at once), which
	// sent another request and asked again. A declined ask now ends the loop.
	describe("a declined api_req_failed ask ends the loop", () => {
		async function declinedError(status: number, autoApprovalEnabled: boolean) {
			const { loop, access, createMessage, backoff } = makeLoop(apiError(status), autoApprovalEnabled)
			const { thrown } = await drain(loop.attemptApiRequest())
			expect(access.askSay.ask).toHaveBeenCalledTimes(1)
			return { loop, access, createMessage, backoff, thrown }
		}

		it.each([
			["401 with auto-approve on", 401, true],
			["500 with auto-approve off", 500, false],
		])("%s: no further request, no further ask", async (_label, status, autoApprovalEnabled) => {
			const { loop, access, createMessage, backoff, thrown } = await declinedError(status, autoApprovalEnabled)
			const abortStream = vi.fn().mockResolvedValue(undefined)
			const stack: any[] = []

			const result = await (loop as any).handleStreamError(thrown, abortStream, { retryAttempt: 0 }, [], stack)

			expect(result).toBe("return_true")
			expect(stack).toEqual([])
			expect(backoff).not.toHaveBeenCalled()
			expect(access.askSay.ask).toHaveBeenCalledTimes(1)
			expect(createMessage).toHaveBeenCalledTimes(1)
			// The request row is still closed, as before.
			expect(abortStream).toHaveBeenCalledWith("streaming_failed", expect.any(String))
		})

		it("webview decline (Start New Task aborts the task): still the user-cancel path", async () => {
			const { loop, access, thrown } = await declinedError(401, true)
			access.abort = true
			const abortStream = vi.fn().mockResolvedValue(undefined)

			const result = await (loop as any).handleStreamError(thrown, abortStream, { retryAttempt: 0 }, [], [])

			expect(result).toBe("return_true")
			expect(abortStream).toHaveBeenCalledWith("user_cancelled", undefined)
			expect(access.abortReason).toBe("user_cancelled")
			expect(access.abortTask).toHaveBeenCalledTimes(1)
		})
	})
})
