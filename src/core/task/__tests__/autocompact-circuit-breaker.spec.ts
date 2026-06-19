// cd src && npx vitest run core/task/__tests__/autocompact-circuit-breaker.spec.ts

import { nextAutoCompactFailureCount, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from "../TaskContextManager"

describe("nextAutoCompactFailureCount", () => {
	it("leaves the counter unchanged when no condense was attempted", () => {
		// No summary and no error => microcompaction-only / truncation-only / no-op pass.
		expect(nextAutoCompactFailureCount(0, { prevContextTokens: 1000 })).toBe(0)
		expect(nextAutoCompactFailureCount(2, { prevContextTokens: 1000, summary: "" })).toBe(2)
		// A truncation-only result (truncationId present, no summary/error) is ignored.
		expect(nextAutoCompactFailureCount(1, { prevContextTokens: 1000, summary: "", newContextTokens: 400 })).toBe(1)
	})

	it("increments when a condense attempt errored", () => {
		expect(nextAutoCompactFailureCount(0, { prevContextTokens: 1000, error: "boom" })).toBe(1)
		expect(nextAutoCompactFailureCount(2, { prevContextTokens: 1000, error: "boom" })).toBe(3)
	})

	it("resets to 0 when a condense attempt genuinely reduced the context", () => {
		expect(nextAutoCompactFailureCount(2, { prevContextTokens: 1000, summary: "ok", newContextTokens: 400 })).toBe(
			0,
		)
	})

	it("increments when a condense produced a summary but did NOT reduce the context", () => {
		// newContextTokens >= prevContextTokens: a non-reducing summary is as futile as an error.
		expect(nextAutoCompactFailureCount(0, { prevContextTokens: 1000, summary: "ok", newContextTokens: 1000 })).toBe(
			1,
		)
		expect(nextAutoCompactFailureCount(1, { prevContextTokens: 1000, summary: "ok", newContextTokens: 1200 })).toBe(
			2,
		)
	})

	it("increments when a summary is present but token counts are unknown (cannot prove reduction)", () => {
		expect(nextAutoCompactFailureCount(0, { prevContextTokens: 1000, summary: "ok" })).toBe(1)
	})

	it("trips after MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES consecutive failures and latches", () => {
		let count = 0
		// Three consecutive errored attempts.
		for (let i = 0; i < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES; i++) {
			count = nextAutoCompactFailureCount(count, { prevContextTokens: 1000, error: "boom" })
		}
		expect(count).toBe(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES)
		expect(count >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES).toBe(true) // breaker open

		// Once open, manageContext skips condense -> subsequent passes carry no
		// summary/error, so the counter stays latched at the cap.
		count = nextAutoCompactFailureCount(count, { prevContextTokens: 1000, summary: "", newContextTokens: 500 })
		expect(count).toBe(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES)
		count = nextAutoCompactFailureCount(count, { prevContextTokens: 1000 })
		expect(count).toBe(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES)
	})

	it("a successful reduction clears accumulated failures before the breaker trips", () => {
		let count = 0
		count = nextAutoCompactFailureCount(count, { prevContextTokens: 1000, error: "boom" }) // 1
		count = nextAutoCompactFailureCount(count, { prevContextTokens: 1000, error: "boom" }) // 2
		expect(count).toBe(2)
		// A genuine reduction resets, so the breaker never trips on intermittent failures.
		count = nextAutoCompactFailureCount(count, { prevContextTokens: 1000, summary: "ok", newContextTokens: 300 })
		expect(count).toBe(0)
	})
})
