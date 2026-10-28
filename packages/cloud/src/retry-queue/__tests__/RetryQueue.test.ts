import type { Mock } from "vitest"

import { RetryQueue } from "../RetryQueue.js"
import type { QueuedRequest, RetryQueueConfig, RetryQueueStorage } from "../types.js"

const STORAGE_KEY = "roo.retryQueue"

const createStorage = (initial?: QueuedRequest[]) => {
	const data = new Map<string, unknown>(initial ? [[STORAGE_KEY, initial]] : [])
	return {
		data,
		get: <T>(key: string) => data.get(key) as T | undefined,
		update: vi.fn(async (key: string, value: unknown) => {
			data.set(key, value)
		}),
	}
}

const stored = (id: string, url: string, timestamp: number, extra: Partial<QueuedRequest> = {}): QueuedRequest => ({
	id,
	url,
	options: { method: "POST" },
	timestamp,
	retryCount: 0,
	type: "telemetry",
	...extra,
})

const response = (status: number, retryAfter?: string) => ({
	ok: status < 400,
	status,
	statusText: `status ${status}`,
	headers: new Headers(retryAfter === undefined ? {} : { "Retry-After": retryAfter }),
})

describe("RetryQueue", () => {
	let fetchMock: Mock
	let storage: ReturnType<typeof createStorage>
	let log: Mock
	const queues: RetryQueue[] = []

	const makeQueue = (
		config: Partial<RetryQueueConfig> = {},
		authHeaders?: () => Record<string, string> | undefined,
	) => {
		// retryDelay 0: back-to-back retryAll() cycles are immediate (per-item backoff is covered in its own spec).
		const queue = new RetryQueue(storage, { retryDelay: 0, ...config }, log, authHeaders)
		queues.push(queue)
		return queue
	}

	const queuedUrls = () => (storage.data.get(STORAGE_KEY) as QueuedRequest[]).map((request) => request.url)

	beforeEach(() => {
		vi.useFakeTimers()
		fetchMock = vi.fn().mockResolvedValue(response(200))
		global.fetch = fetchMock
		storage = createStorage()
		log = vi.fn()
	})

	afterEach(() => {
		queues.splice(0).forEach((queue) => queue.dispose())
		vi.useRealTimers()
	})

	describe("queue and storage", () => {
		it("persists and announces an enqueued request", async () => {
			const queue = makeQueue()
			const queued = vi.fn()
			queue.on("request-queued", queued)

			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry", "op")

			const [request] = storage.data.get(STORAGE_KEY) as QueuedRequest[]
			expect(request).toMatchObject({
				url: "https://api.example.com/a",
				type: "telemetry",
				operation: "op",
				retryCount: 0,
			})
			expect(queued).toHaveBeenCalledWith(request)
		})

		it("evicts the oldest request when full", async () => {
			const queue = makeQueue({ maxQueueSize: 3 })

			for (let i = 1; i <= 4; i++) {
				await queue.enqueue(`https://api.example.com/${i}`, { method: "POST" }, "telemetry")
			}

			expect(queuedUrls()).toEqual([
				"https://api.example.com/2",
				"https://api.example.com/3",
				"https://api.example.com/4",
			])
		})

		it("keeps requests and their retry counts across a restart", async () => {
			fetchMock.mockRejectedValue(new Error("Network error"))
			const first = makeQueue()
			await first.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")
			await first.retryAll()
			await first.retryAll()
			first.dispose()

			const second = makeQueue()
			expect(second.getStats()).toMatchObject({ totalQueued: 1, totalRetries: 2 })

			// 2 persisted + 3 new failures reach the default limit of 5.
			for (let i = 0; i < 3; i++) {
				await second.retryAll()
			}
			expect(second.getStats().totalQueued).toBe(0)
		})

		it("neither loads nor stores anything with persistQueue off", async () => {
			storage = createStorage([stored("old", "https://api.example.com/old", 1)])
			const queue = makeQueue({ persistQueue: false })

			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			expect(queue.getStats().totalQueued).toBe(1)
			expect(storage.update).not.toHaveBeenCalled()
		})

		it("logs, and keeps working, when the storage fails", async () => {
			const broken: RetryQueueStorage = {
				get: () => {
					throw new Error("read failed")
				},
				update: () => Promise.reject(new Error("write failed")),
			}
			const queue = new RetryQueue(broken, {}, log)
			queues.push(queue)

			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			expect(queue.getStats().totalQueued).toBe(1)
			expect(log).toHaveBeenCalledWith("[RetryQueue] Failed to load persisted queue:", expect.any(Error))
			expect(log).toHaveBeenCalledWith("[RetryQueue] Failed to persist queue:", expect.any(Error))
		})

		it("reports counts by type, retries, failures and the oldest and newest request", async () => {
			storage = createStorage([
				stored("a", "https://api.example.com/a", 1_000, { retryCount: 2, lastError: "boom" }),
				stored("b", "https://api.example.com/b", 3_000, { type: "api-call" }),
				stored("c", "https://api.example.com/c", 2_000, { retryCount: 1 }),
			])

			expect(makeQueue().getStats()).toEqual({
				totalQueued: 3,
				byType: { telemetry: 2, "api-call": 1 },
				oldestRequest: new Date(1_000),
				newestRequest: new Date(3_000),
				totalRetries: 3,
				failedRetries: 1,
			})
		})

		it("clears, stores the empty queue and announces it", async () => {
			const queue = makeQueue()
			const cleared = vi.fn()
			queue.on("queue-cleared", cleared)
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			queue.clear()

			expect(queue.getStats().totalQueued).toBe(0)
			expect(storage.data.get(STORAGE_KEY)).toEqual([])
			expect(cleared).toHaveBeenCalledTimes(1)
		})
	})

	it("clears the queue when the signed-in user changes, but not on the first sign-in", async () => {
		const queue = makeQueue()
		const enqueue = () => queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")
		const steps: Array<[string | undefined, boolean]> = [
			["u1", false], // first sign-in keeps what was queued before it
			["u1", false],
			[undefined, true], // sign-out
			["u2", true],
			["u2", false],
			["u3", true],
		]

		for (const [user, clears] of steps) {
			await enqueue()
			const before = queue.getStats().totalQueued
			expect(queue.clearIfUserChanged(user)).toBe(clears)
			expect(queue.getStats().totalQueued).toBe(clears ? 0 : before)
		}
	})

	describe("retryAll", () => {
		it("sends the oldest request first and drops each delivered one", async () => {
			storage = createStorage([
				stored("b", "https://api.example.com/b", 2),
				stored("a", "https://api.example.com/a", 1),
			])
			const queue = makeQueue()
			const delivered = vi.fn()
			queue.on("request-retry-success", delivered)

			await queue.retryAll()

			expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
				"https://api.example.com/a",
				"https://api.example.com/b",
			])
			expect(delivered).toHaveBeenCalledTimes(2)
			expect(queue.getStats().totalQueued).toBe(0)
			expect(storage.data.get(STORAGE_KEY)).toEqual([])
		})

		it("sends fresh auth headers over the stored ones, marked as a retry, with a timeout signal", async () => {
			const queue = makeQueue({}, () => ({ Authorization: "Bearer fresh" }))
			await queue.enqueue(
				"https://api.example.com/a",
				{ method: "POST", headers: { Authorization: "Bearer stale", "Content-Type": "application/json" } },
				"telemetry",
			)

			await queue.retryAll()

			const [, options] = fetchMock.mock.calls[0]!
			expect(options.method).toBe("POST")
			expect(options.signal).toBeInstanceOf(AbortSignal)
			expect(options.headers).toEqual({
				Authorization: "Bearer fresh",
				"content-type": "application/json",
				"X-Retry-Queue": "true",
			})
		})

		it("sends no credentials when the auth provider has none: the stored ones were never kept", async () => {
			const queue = makeQueue({}, () => undefined)
			await queue.enqueue(
				"https://api.example.com/a",
				{ headers: { Authorization: "Bearer stored" } },
				"telemetry",
			)

			await queue.retryAll()

			expect(fetchMock.mock.calls[0]![1].headers).toEqual({
				"X-Retry-Queue": "true",
			})
		})

		it.each([
			["a network error", () => fetchMock.mockRejectedValueOnce(new Error("Network error")), "Network error"],
			["a server error", () => fetchMock.mockResolvedValueOnce(response(503)), "Server error: 503 status 503"],
		])("keeps a request after %s and counts the failure", async (_name, fail, lastError) => {
			const queue = makeQueue()
			const failed = vi.fn()
			queue.on("request-retry-failed", failed)
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			fail()
			await queue.retryAll()

			expect(failed).toHaveBeenCalledWith(
				expect.objectContaining({ retryCount: 1, lastError }),
				expect.any(Error),
			)
			expect(queue.getStats().totalQueued).toBe(1)

			await queue.retryAll()
			expect(queue.getStats().totalQueued).toBe(0)
		})

		it("aborts a request that outlives requestTimeout and counts it as a failure", async () => {
			fetchMock.mockImplementation(
				(_url: string, options: RequestInit) =>
					new Promise((_resolve, reject) => {
						options.signal!.addEventListener("abort", () => reject(new Error("aborted")))
					}),
			)
			const queue = makeQueue({ requestTimeout: 1_000 })
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			const cycle = queue.retryAll()
			await vi.advanceTimersByTimeAsync(1_000)
			await cycle

			expect(queue.getStats()).toMatchObject({ totalQueued: 1, totalRetries: 1, failedRetries: 1 })
		})

		it.each([
			[5, undefined],
			[2, 2],
		])("discards a request after %i failures (maxRetries %s)", async (failures, maxRetries) => {
			fetchMock.mockRejectedValue(new Error("Network error"))
			const queue = makeQueue(maxRetries === undefined ? {} : { maxRetries })
			const exceeded = vi.fn()
			queue.on("request-max-retries-exceeded", exceeded)
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			for (let i = 1; i < failures; i++) {
				await queue.retryAll()
			}
			expect(queue.getStats().totalQueued).toBe(1)

			await queue.retryAll()
			expect(queue.getStats().totalQueued).toBe(0)
			expect(exceeded).toHaveBeenCalledWith(expect.objectContaining({ retryCount: failures }), expect.any(Error))
		})

		it("never discards with maxRetries 0", async () => {
			fetchMock.mockRejectedValue(new Error("Network error"))
			const queue = makeQueue({ maxRetries: 0 })
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			for (let i = 0; i < 8; i++) {
				await queue.retryAll()
			}

			expect(queue.getStats()).toMatchObject({ totalQueued: 1, totalRetries: 8 })
		})

		it.each([400, 401, 403, 404, 413, 422])(
			"drops a request refused with %i without retrying it",
			async (status) => {
				fetchMock.mockResolvedValueOnce(response(status))
				const queue = makeQueue()
				await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

				await queue.retryAll()

				expect(queue.getStats().totalQueued).toBe(0)
				expect(fetchMock).toHaveBeenCalledTimes(1)
			},
		)

		it.each([
			["seconds", () => "2", 2_000],
			["an HTTP date", () => new Date(Date.now() + 3_000).toUTCString(), 3_000],
			["an unreadable value", () => "soon", 60_000],
		])("pauses the whole queue on 429 for a Retry-After in %s", async (_name, retryAfter, pauseMs) => {
			vi.setSystemTime(new Date("2026-10-25T00:00:00Z"))
			const queue = makeQueue()
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")
			await queue.enqueue("https://api.example.com/b", { method: "POST" }, "telemetry")
			fetchMock.mockResolvedValueOnce(response(429, retryAfter()))

			await queue.retryAll()
			expect(fetchMock).toHaveBeenCalledTimes(1)
			expect(queue.getStats().totalQueued).toBe(2)

			await vi.advanceTimersByTimeAsync(pauseMs - 1)
			await queue.retryAll()
			expect(fetchMock).toHaveBeenCalledTimes(1)

			await vi.advanceTimersByTimeAsync(1)
			await queue.retryAll()
			expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
				"https://api.example.com/a",
				"https://api.example.com/a",
				"https://api.example.com/b",
			])
			expect(queue.getStats().totalQueued).toBe(0)
		})

		it("drops a 429 that names no Retry-After like any other refusal", async () => {
			fetchMock.mockResolvedValueOnce(response(429))
			const queue = makeQueue()
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			await queue.retryAll()

			expect(queue.getStats().totalQueued).toBe(0)
		})

		it("skips a cycle while paused or while another cycle runs", async () => {
			const queue = makeQueue()
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			queue.pause()
			await queue.retryAll()
			expect(fetchMock).not.toHaveBeenCalled()
			queue.resume()

			let deliver!: (value: unknown) => void
			fetchMock.mockReturnValueOnce(new Promise((resolve) => (deliver = resolve)))
			const first = queue.retryAll()
			await queue.retryAll()
			expect(fetchMock).toHaveBeenCalledTimes(1)

			deliver(response(200))
			await first
			expect(queue.getStats().totalQueued).toBe(0)
		})

		it("runs on its own every networkCheckInterval until disposed", async () => {
			const queue = makeQueue({ networkCheckInterval: 5_000 })
			await queue.enqueue("https://api.example.com/a", { method: "POST" }, "telemetry")

			await vi.advanceTimersByTimeAsync(5_000)
			expect(fetchMock).toHaveBeenCalledTimes(1)

			await queue.enqueue("https://api.example.com/b", { method: "POST" }, "telemetry")
			queue.dispose()
			await vi.advanceTimersByTimeAsync(5_000)
			expect(fetchMock).toHaveBeenCalledTimes(1)
		})
	})
})
