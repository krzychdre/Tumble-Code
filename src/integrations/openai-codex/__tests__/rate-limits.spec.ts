import { describe, it, expect, vi, afterEach } from "vitest"

import { fetchOpenAiCodexRateLimitInfo, parseOpenAiCodexUsagePayload } from "../rate-limits"

describe("parseOpenAiCodexUsagePayload()", () => {
	it("maps primary/secondary windows", () => {
		const fetchedAt = 1234567890000
		const payload = {
			rate_limit: {
				primary_window: { used_percent: 12.34, limit_window_seconds: 300 * 60, reset_at: 1700000000 },
				secondary_window: { used_percent: 99.9, limit_window_seconds: 10080 * 60, reset_at: 1700000000 },
			},
			plan_type: "plus",
		}

		const out = parseOpenAiCodexUsagePayload(payload, fetchedAt)

		expect(out).toEqual({
			primary: {
				usedPercent: 12.34,
				windowMinutes: 300,
				resetsAt: 1700000000 * 1000,
			},
			secondary: {
				usedPercent: 99.9,
				windowMinutes: 10080,
				resetsAt: 1700000000 * 1000,
			},
			planType: "plus",
			fetchedAt,
		})
	})

	it("clamps used_percent to 0–100 and tolerates missing fields", () => {
		const fetchedAt = 1
		const payload = {
			rate_limit: {
				primary_window: { used_percent: 1000 },
				secondary_window: { used_percent: -5 },
			},
		}
		const out = parseOpenAiCodexUsagePayload(payload, fetchedAt)
		expect(out.primary?.usedPercent).toBe(100)
		expect(out.secondary?.usedPercent).toBe(0)
		expect(out.fetchedAt).toBe(fetchedAt)
	})
})

describe("fetchOpenAiCodexRateLimitInfo()", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	// R5: the usage lookup is a short control request; on a dropped connection it must give up.
	it("aborts the request after the control request timeout", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1 } } }), { status: 200 }),
			)
		vi.stubGlobal("fetch", fetchMock)
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout")

		await fetchOpenAiCodexRateLimitInfo("token")

		expect(timeoutSpy).toHaveBeenCalledWith(30_000)
		expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
	})
})
