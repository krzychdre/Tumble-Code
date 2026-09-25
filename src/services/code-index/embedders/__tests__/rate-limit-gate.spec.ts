import type { MockedClass, MockedFunction } from "vitest"
import { OpenAI } from "openai"

import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { RateLimitGate, rateLimitGateFor, resetRateLimitGates } from "../rate-limit-gate"

// Mock the OpenAI SDK
vi.mock("openai")

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock i18n
vi.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"embeddings:rateLimitRetry": `Rate limit hit, retrying in ${params?.delayMs}ms (attempt ${params?.attempt}/${params?.maxRetries})`,
			"embeddings:failedMaxAttempts": `Failed to create embeddings after ${params?.attempts} attempts`,
			"embeddings:failedWithStatus": `Failed to create embeddings after ${params?.attempts} attempts: HTTP ${params?.statusCode} - ${params?.errorMessage}`,
			"embeddings:failedWithError": `Failed to create embeddings after ${params?.attempts} attempts: ${params?.errorMessage}`,
		}
		return translations[key] || key
	},
}))

const MockedOpenAI = OpenAI as MockedClass<typeof OpenAI>

describe("RateLimitGate", () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: Date.UTC(2030, 0, 1) })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("has no backoff until a rate limit is recorded", () => {
		expect(new RateLimitGate().remainingDelay()).toBe(0)
	})

	it("doubles the backoff for 429s less than a minute apart", () => {
		const gate = new RateLimitGate()

		gate.recordRateLimit()
		expect(gate.remainingDelay()).toBe(5_000)

		vi.advanceTimersByTime(5_000)
		gate.recordRateLimit()
		expect(gate.remainingDelay()).toBe(10_000)

		vi.advanceTimersByTime(10_000)
		gate.recordRateLimit()
		expect(gate.remainingDelay()).toBe(20_000)
	})

	it("keeps escalating after a backoff has run out, as long as the 429s stay within a minute", () => {
		// A retry sent right after the backoff that gets another 429 must wait longer, not
		// start over at 5 s (the old per-class state reset the count whenever a wait ended).
		const gate = new RateLimitGate()
		gate.recordRateLimit()
		vi.advanceTimersByTime(5_000)
		expect(gate.remainingDelay()).toBe(0)

		gate.recordRateLimit()
		expect(gate.remainingDelay()).toBe(10_000)
	})

	it("starts over at 5 s when the previous 429 is more than a minute old", () => {
		const gate = new RateLimitGate()
		gate.recordRateLimit()
		gate.recordRateLimit()
		gate.recordRateLimit()

		vi.advanceTimersByTime(70_000)
		gate.recordRateLimit()

		expect(gate.remainingDelay()).toBe(5_000)
	})

	it("never waits longer than 5 minutes", () => {
		const gate = new RateLimitGate()
		for (let i = 0; i < 12; i++) {
			gate.recordRateLimit()
		}

		expect(gate.remainingDelay()).toBe(300_000)
	})

	it("wait() resolves once the backoff is over", async () => {
		const gate = new RateLimitGate()
		gate.recordRateLimit()
		let done = false
		const waiting = gate.wait().then(() => (done = true))

		await vi.advanceTimersByTimeAsync(4_999)
		expect(done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		await waiting
		expect(done).toBe(true)
	})

	it("hands out one gate per endpoint key", () => {
		resetRateLimitGates()
		expect(rateLimitGateFor("http://a/v1")).toBe(rateLimitGateFor("http://a/v1"))
		expect(rateLimitGateFor("http://a/v1")).not.toBe(rateLimitGateFor("http://b/v1"))
	})
})

describe("OpenAICompatibleEmbedder - shared rate limiting", () => {
	let mockEmbeddingsCreate: MockedFunction<any>

	const testBaseUrl = "https://api.openai.com/v1"
	const testApiKey = "test-api-key"
	const testModelId = "text-embedding-3-small"

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		resetRateLimitGates()

		mockEmbeddingsCreate = vi.fn()
		MockedOpenAI.mockImplementation(() => ({ embeddings: { create: mockEmbeddingsCreate } }) as any)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("should apply the rate limit across instances on the same endpoint", async () => {
		const embedder1 = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		const embedder2 = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

		const rateLimitError = new Error("Rate limit exceeded") as any
		rateLimitError.status = 429

		mockEmbeddingsCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValue({
			data: [{ embedding: "AAAAAA==" }],
			usage: { prompt_tokens: 10, total_tokens: 15 },
		})

		// First batch hits the rate limit
		const batch1Promise = embedder1.createEmbeddings(["test1"])
		await vi.advanceTimersByTimeAsync(100)

		// Second batch starts while the backoff is active and has to wait for it
		const batch2Promise = embedder2.createEmbeddings(["test2"])
		await vi.advanceTimersByTimeAsync(100)
		expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
		expect(rateLimitGateFor(testBaseUrl).remainingDelay()).toBeGreaterThan(0)

		// Once the 5 s backoff is over, both requests complete
		await vi.advanceTimersByTimeAsync(5000)
		const [result1, result2] = await Promise.all([batch1Promise, batch2Promise])

		expect(result1.embeddings).toHaveLength(1)
		expect(result2.embeddings).toHaveLength(1)
		expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3)
	})
})
