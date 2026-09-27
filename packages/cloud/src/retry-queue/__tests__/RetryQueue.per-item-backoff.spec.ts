import type { Mock } from "vitest"

import { RetryQueue } from "../RetryQueue.js"

// R11: per-item backoff. Before, every retryAll() attempt retried the whole
// queue, so a request that had waited 5 s got the same full penalty as one
// that just failed. Now each request carries its own nextAttemptAt and only
// its own failures push it back.

const createStorage = () => {
	const data = new Map<string, unknown>()
	return {
		get: <T>(key: string) => data.get(key) as T | undefined,
		update: async (key: string, value: unknown) => {
			data.set(key, value)
		},
	}
}

describe("RetryQueue per-item backoff (R11)", () => {
	let fetchMock: Mock
	let retryQueue: RetryQueue

	beforeEach(() => {
		vi.useFakeTimers()
		fetchMock = vi.fn()
		global.fetch = fetchMock
		retryQueue = new RetryQueue(createStorage(), {
			retryDelay: 60_000,
			retryDelayMaxMs: 300_000,
			maxRetries: 5,
			// No jitter: every failure pushes its item by exactly retryDelay.
			random: () => 1,
			// Retries are driven by explicit retryAll() calls in these tests,
			// not by the background interval.
			networkCheckInterval: 1_000_000_000,
		})
	})

	afterEach(() => {
		retryQueue.dispose()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("item B is not penalised by item A's failure", async () => {
		await retryQueue.enqueue("https://api.example.com/A", { method: "POST" }, "telemetry")
		await retryQueue.enqueue("https://api.example.com/B", { method: "POST" }, "telemetry")

		// A fails (network error), B succeeds.
		fetchMock.mockImplementationOnce(() => Promise.reject(new Error("Network error")))
		fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: true }))

		await retryQueue.retryAll()

		// A stays queued with a 60 s penalty; B is gone (delivered).
		expect(retryQueue.getStats().totalQueued).toBe(1)
		expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
			"https://api.example.com/A",
			"https://api.example.com/B",
		])

		// A is not retried before its own window elapses.
		fetchMock.mockClear()
		fetchMock.mockImplementation(() => Promise.resolve({ ok: true }))
		await retryQueue.retryAll()
		expect(fetchMock).not.toHaveBeenCalled()

		// After A's own 60 s pass, A is retried (and now succeeds).
		await vi.advanceTimersByTimeAsync(60_000)
		await retryQueue.retryAll()
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.example.com/A")
		expect(retryQueue.getStats().totalQueued).toBe(0)
	})

	it("a failing item's window moves independently of the others", async () => {
		await retryQueue.enqueue("https://api.example.com/A", { method: "POST" }, "telemetry")
		await retryQueue.enqueue("https://api.example.com/B", { method: "POST" }, "telemetry")

		// First cycle: both fail, both get a 60 s window ending at t = 60 s.
		fetchMock.mockImplementation(() => Promise.reject(new Error("Network error")))
		await retryQueue.retryAll()
		expect(retryQueue.getStats().totalRetries).toBe(2)

		// Nothing is due before t = 60 s.
		await vi.advanceTimersByTimeAsync(59_999)
		fetchMock.mockClear()
		await retryQueue.retryAll()
		expect(fetchMock).not.toHaveBeenCalled()

		// At t = 60 s both are due. Let A fail again (this is A's second
		// failure, so its own window moves to t = 60 s + 120 s = 180 s) while
		// B succeeds and leaves the queue.
		await vi.advanceTimersByTimeAsync(1)
		fetchMock
			.mockImplementationOnce(() => Promise.reject(new Error("Network error")))
			.mockImplementationOnce(() => Promise.resolve({ ok: true }))
		await retryQueue.retryAll()
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(retryQueue.getStats().totalQueued).toBe(1) // only A remains

		// At t = 70 s: A is still inside its own new window — not retried.
		await vi.advanceTimersByTimeAsync(10_000)
		fetchMock.mockClear()
		fetchMock.mockImplementation(() => Promise.resolve({ ok: true }))
		await retryQueue.retryAll()
		expect(fetchMock).not.toHaveBeenCalled()

		// At t = 120 s: A's window (exponential: 2 × 60 s after the second
		// failure) still has a minute left.
		await vi.advanceTimersByTimeAsync(50_000)
		await retryQueue.retryAll()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(retryQueue.getStats().totalQueued).toBe(1)

		// At t = 180 s: A's own window elapses and it is retried.
		await vi.advanceTimersByTimeAsync(60_000)
		await retryQueue.retryAll()
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.example.com/A")
		expect(retryQueue.getStats().totalQueued).toBe(0)
	})

	it("applies jitter to the per-item delay (seeded random)", async () => {
		const seededQueue = new RetryQueue(createStorage(), {
			retryDelay: 60_000,
			retryDelayMaxMs: 300_000,
			random: () => 0, // bottom of the equal-jitter band → 30 s
		})
		await seededQueue.enqueue("https://api.example.com/A", { method: "POST" }, "telemetry")

		fetchMock.mockImplementation(() => Promise.reject(new Error("Network error")))
		await seededQueue.retryAll()

		// With random()=0 the delay is retryDelay/2 = 30 s, not 60 s.
		await vi.advanceTimersByTimeAsync(29_999)
		fetchMock.mockClear()
		await seededQueue.retryAll()
		expect(fetchMock).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await seededQueue.retryAll()
		expect(fetchMock).toHaveBeenCalledTimes(1)

		seededQueue.dispose()
	})

	it("persists nextAttemptAt across restarts", async () => {
		const storage = createStorage()
		const queue1 = new RetryQueue(storage, { retryDelay: 60_000, retryDelayMaxMs: 300_000, random: () => 1 })
		await queue1.enqueue("https://api.example.com/A", { method: "POST" }, "telemetry")

		fetchMock.mockImplementation(() => Promise.reject(new Error("Network error")))
		await queue1.retryAll()
		queue1.dispose()

		const persisted = storage.get<Array<{ nextAttemptAt?: number }>>("roo.retryQueue")
		expect(persisted).toHaveLength(1)
		expect(persisted![0]!.nextAttemptAt).toBeGreaterThan(Date.now())

		const queue2 = new RetryQueue(storage, { retryDelay: 60_000, retryDelayMaxMs: 300_000, random: () => 1 })
		// Fresh queue honours the persisted window.
		fetchMock.mockClear()
		await queue2.retryAll()
		expect(fetchMock).not.toHaveBeenCalled()
		queue2.dispose()
	})
})
