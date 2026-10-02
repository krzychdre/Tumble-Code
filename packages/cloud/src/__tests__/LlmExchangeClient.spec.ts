/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/LlmExchangeClient.spec.ts

import { gunzipSync } from "zlib"

import type { LlmExchange } from "@tumble-code/types"

import { LlmExchangeClient } from "../LlmExchangeClient.js"

vi.mock("../config.js", () => ({ getTumbleCodeApiUrl: () => "https://cloud.example" }))

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const SHA = "a".repeat(64)

const EXCHANGE: LlmExchange = {
	id: "4b0d2f6e-6a7e-4d55-9d36-3c1f0e7a9b10",
	taskId: "task-1",
	sequence: 0,
	occurredAt: 1_760_000_000_000,
	retryAttempt: 0,
	modelId: "glm-5.3",
	request: {
		system: { sha256: SHA, text: "You are Tumble." },
		tools: { sha256: SHA, text: "[]" },
		messages: { keep: 0, append: [{ role: "user", content: "hi" }] },
		messageCount: 1,
		params: {},
	},
	response: { text: "hello" },
	status: "completed",
}

function ok(body: unknown = { success: true }) {
	return { ok: true, status: 200, json: async () => body }
}

describe("LlmExchangeClient", () => {
	let authService: any
	let now: number
	let client: LlmExchangeClient
	const sleep = vi.fn(async (_ms: number) => {})

	beforeEach(() => {
		vi.clearAllMocks()
		now = 1_000_000
		authService = {
			getSessionToken: vi.fn().mockReturnValue("session-token"),
			isAuthenticated: vi.fn().mockReturnValue(true),
		}
		mockFetch.mockResolvedValue(ok())
		client = new LlmExchangeClient(authService, () => {}, { sleep, now: () => now })
	})

	describe("the recording switch", () => {
		it("is unknown until read, then cached for five minutes per session", async () => {
			mockFetch.mockResolvedValue(ok({ enabled: true }))

			expect(client.getRecordingState()).toBeUndefined()
			expect(await client.resolveRecordingEnabled()).toBe(true)
			expect(client.getRecordingState()).toBe(true)
			expect(mockFetch).toHaveBeenCalledWith(
				"https://cloud.example/api/llm-exchanges/config",
				expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer session-token" } }),
			)

			await client.resolveRecordingEnabled()
			expect(mockFetch).toHaveBeenCalledTimes(1)

			now += 5 * 60_000
			expect(client.getRecordingState()).toBeUndefined()

			authService.getSessionToken.mockReturnValue("another-session")
			expect(client.getRecordingState()).toBeUndefined()
		})

		it("reads once for concurrent callers", async () => {
			mockFetch.mockResolvedValue(ok({ enabled: true }))

			const results = await Promise.all([client.resolveRecordingEnabled(), client.resolveRecordingEnabled()])

			expect(results).toEqual([true, true])
			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it("is off when signed out, without a request", async () => {
			authService.isAuthenticated.mockReturnValue(false)

			expect(client.getRecordingState()).toBe(false)
			expect(await client.resolveRecordingEnabled()).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("is off after a failed read, and asked again a minute later", async () => {
			mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))

			expect(await client.resolveRecordingEnabled()).toBe(false)
			expect(client.getRecordingState()).toBe(false)

			now += 60_000
			expect(client.getRecordingState()).toBeUndefined()
		})
	})

	describe("uploads", () => {
		it("posts the exchange gzip-compressed with the session token", async () => {
			expect(await client.sendExchange(EXCHANGE)).toBe(true)

			const [url, options] = mockFetch.mock.calls[0]!
			expect(url).toBe("https://cloud.example/api/llm-exchanges")
			expect(options.method).toBe("POST")
			expect(options.headers).toEqual({
				Authorization: "Bearer session-token",
				"Content-Type": "application/json",
				"Content-Encoding": "gzip",
			})
			expect(JSON.parse(gunzipSync(options.body).toString("utf8"))).toEqual(EXCHANGE)
		})

		it("posts an outcome to its own path", async () => {
			const outcome = {
				exchangeId: EXCHANGE.id,
				taskId: "task-1",
				toolResults: [{ toolName: "read_file", status: "ok" as const }],
			}

			expect(await client.sendOutcome(outcome)).toBe(true)

			const [url, options] = mockFetch.mock.calls[0]!
			expect(url).toBe("https://cloud.example/api/llm-exchanges/outcome")
			expect(JSON.parse(gunzipSync(options.body).toString("utf8"))).toEqual(outcome)
		})

		it("retries 5xx, 429 and network failures twice, then gives up", async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: false, status: 503 })
				.mockRejectedValueOnce(new TypeError("fetch failed"))
				.mockResolvedValueOnce({ ok: false, status: 429 })

			expect(await client.sendExchange(EXCHANGE)).toBe(false)
			expect(mockFetch).toHaveBeenCalledTimes(3)
			expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 8_000])
		})

		it("succeeds on a retry", async () => {
			mockFetch.mockResolvedValueOnce({ ok: false, status: 502 }).mockResolvedValueOnce(ok())

			expect(await client.sendExchange(EXCHANGE)).toBe(true)
			expect(mockFetch).toHaveBeenCalledTimes(2)
		})

		it("does not retry a client error", async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 413 })

			expect(await client.sendExchange(EXCHANGE)).toBe(false)
			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it("sends nothing signed out, and stops retrying after a sign-out", async () => {
			authService.isAuthenticated.mockReturnValue(false)
			expect(await client.sendExchange(EXCHANGE)).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()

			authService.isAuthenticated.mockReturnValue(true)
			mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
			sleep.mockImplementationOnce(async () => authService.isAuthenticated.mockReturnValue(false))
			expect(await client.sendExchange(EXCHANGE)).toBe(false)
			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it("refuses an exchange that breaks the contract", async () => {
			const broken = { ...EXCHANGE, request: { ...EXCHANGE.request, system: { sha256: "nope" } } }

			expect(await client.sendExchange(broken as LlmExchange)).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("learns from the answer that recording was switched off", async () => {
			mockFetch.mockResolvedValue(ok({ success: true, stored: false, recording: false }))

			await client.sendExchange(EXCHANGE)

			expect(client.getRecordingState()).toBe(false)
		})
	})
})
