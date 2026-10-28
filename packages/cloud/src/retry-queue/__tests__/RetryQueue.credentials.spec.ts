// A real HTTP server receives the retries; the storage is an in-memory Memento.

import { createServer, type IncomingHttpHeaders, type Server } from "http"
import type { AddressInfo } from "net"

import { RetryQueue, withoutCredentials } from "../RetryQueue.js"
import type { QueuedRequest } from "../types.js"

const STORAGE_KEY = "roo.retryQueue"

function memoryStorage(initial?: QueuedRequest[]) {
	const data = new Map<string, unknown>(initial ? [[STORAGE_KEY, initial]] : [])
	return {
		data,
		get: <T>(key: string) => data.get(key) as T | undefined,
		update: async (key: string, value: unknown) => void data.set(key, value),
	}
}

describe("RetryQueue keeps no credentials", () => {
	let server: Server
	let url: string
	const received: IncomingHttpHeaders[] = []
	const queues: RetryQueue[] = []

	beforeAll(async () => {
		server = createServer((req, res) => {
			received.push(req.headers)
			res.end("{}")
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/events`
	})

	afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

	afterEach(() => {
		queues.splice(0).forEach((queue) => queue.dispose())
		received.length = 0
	})

	const makeQueue = (storage: ReturnType<typeof memoryStorage>, token?: string) => {
		const queue = new RetryQueue(
			storage,
			{ retryDelay: 0 },
			() => {},
			() => (token ? { Authorization: `Bearer ${token}` } : undefined),
		)
		queues.push(queue)
		return queue
	}

	it("stores a queued request without its Authorization header and retries with a fresh token", async () => {
		const storage = memoryStorage()
		const queue = makeQueue(storage, "fresh-token")

		await queue.enqueue(
			url,
			{
				method: "POST",
				body: '{"type":"x"}',
				headers: { Authorization: "Bearer old-session-jwt", "Content-Type": "application/json" },
			},
			"telemetry",
		)

		const persisted = JSON.stringify(storage.data.get(STORAGE_KEY))
		expect(persisted).not.toContain("old-session-jwt")
		expect(persisted.toLowerCase()).not.toContain("authorization")
		expect(persisted).toContain("application/json")

		await queue.retryAll()

		expect(received).toHaveLength(1)
		expect(received[0]?.authorization).toBe("Bearer fresh-token")
		expect(received[0]?.["content-type"]).toBe("application/json")
		expect(storage.data.get(STORAGE_KEY)).toEqual([])
	})

	it("drops the token a queue written by an older version kept, on load", async () => {
		const storage = memoryStorage([
			{
				id: "1",
				url,
				options: { method: "POST", body: "{}", headers: { Authorization: "Bearer leaked", Cookie: "s=1" } },
				timestamp: 1,
				retryCount: 0,
				type: "telemetry",
			},
		])

		makeQueue(storage)
		await vi.waitFor(() => expect(JSON.stringify(storage.data.get(STORAGE_KEY))).not.toContain("leaked"))
		expect(JSON.stringify(storage.data.get(STORAGE_KEY))).not.toContain("s=1")
	})

	it("withoutCredentials keeps every other header, whatever form they come in", () => {
		const forms: RequestInit["headers"][] = [
			{ authorization: "a", "X-Retry": "1" },
			new Headers({ Authorization: "a", "X-Retry": "1" }),
			[
				["Proxy-Authorization", "a"],
				["X-Retry", "1"],
			],
		]
		for (const headers of forms) {
			expect(withoutCredentials({ method: "POST", headers })).toEqual({
				method: "POST",
				headers: { "x-retry": "1" },
			})
		}
	})
})
