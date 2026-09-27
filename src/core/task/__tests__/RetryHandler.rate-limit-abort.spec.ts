import { RetryHandler, setLastGlobalApiRequestTime } from "../RetryHandler"
import type { RetryHandlerAccess } from "../RetryHandler"
import type { TaskAskSay } from "../TaskAskSay"
import type { ClineProvider } from "../../webview/ClineProvider"

/**
 * D1 regression: the rate-limit countdown (`maybeWaitForProviderRateLimit`)
 * used to ignore `abort` — a cancelled task still waited out the whole
 * rate-limit window before the next request.
 */

function makeHandler(overrides: Partial<RetryHandlerAccess> = {}) {
	const say = vi.fn().mockResolvedValue(undefined)
	const provider = { getState: async () => undefined } as unknown as ClineProvider
	const access: RetryHandlerAccess = {
		taskId: "test-task",
		instanceId: "test-instance",
		abort: false,
		apiConfiguration: { apiProvider: "anthropic", rateLimitSeconds: 30 },
		providerRef: new WeakRef(provider),
		askSay: { say } as unknown as TaskAskSay,
		...overrides,
	}
	return { handler: new RetryHandler(access), access, say }
}

describe("RetryHandler.calculateBackoffDelay requestDelaySeconds (D2)", () => {
	it("returns 0 when the user set requestDelaySeconds to 0 (|| used to mask it to 5)", () => {
		const { handler } = makeHandler()
		expect(handler.calculateBackoffDelay(0, undefined, { requestDelaySeconds: 0 })).toBe(0)
	})

	it("uses the table default (5 s) when the setting is unset", () => {
		const { handler } = makeHandler()
		expect(handler.calculateBackoffDelay(0, undefined, {})).toBe(5)
	})
})

describe("RetryHandler.maybeWaitForProviderRateLimit abort (D1)", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("rejects when the task is aborted mid-countdown instead of counting to the end", async () => {
		// Non-zero: 0 is falsy in the gate that checks a request was ever made.
		setLastGlobalApiRequestTime(1)

		const { handler, access, say } = makeHandler()
		// First say() tick flips the task to aborted, like a user pressing Stop.
		say.mockImplementation(async () => {
			access.abort = true
		})

		let settled: { aborted: boolean } | undefined
		void handler
			.maybeWaitForProviderRateLimit(0)
			.then(() => (settled = { aborted: false }))
			.catch(() => (settled = { aborted: true }))

		// Let the countdown start and the abort land on the first tick.
		await vi.advanceTimersByTimeAsync(1_500)
		expect(settled).toEqual({ aborted: true })
		// The whole 30 s window has not passed.
		expect(say).toHaveBeenCalledTimes(1)
	})

	it("still counts down to the end when no abort happens", async () => {
		setLastGlobalApiRequestTime(1)

		const { handler, say } = makeHandler()
		const done = handler.maybeWaitForProviderRateLimit(0)

		await vi.advanceTimersByTimeAsync(29_000)
		// The closing say(undefined payload) has not run yet.
		expect(say).not.toHaveBeenCalledWith("api_req_rate_limit_wait", undefined, undefined, false)
		await vi.advanceTimersByTimeAsync(1_000)
		await done
		expect(say).toHaveBeenCalledWith("api_req_rate_limit_wait", undefined, undefined, false)
	})
})
