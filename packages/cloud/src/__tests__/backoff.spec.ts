import { backoffDelayMs } from "../backoff.js"

describe("backoffDelayMs (equal jitter)", () => {
	const seq = (values: number[]) => {
		let i = 0
		return () => values[i++ % values.length] ?? 0
	}

	it("returns half the raw backoff when random() is always 0", () => {
		expect(backoffDelayMs(0, { baseMs: 1000, capMs: 60_000, random: () => 0 })).toBe(500)
		expect(backoffDelayMs(1, { baseMs: 1000, capMs: 60_000, random: () => 0 })).toBe(1000)
	})

	it("returns the full raw backoff when random() is always 1", () => {
		// random() < 1 strictly, but the contract is [raw/2, raw]
		expect(backoffDelayMs(0, { baseMs: 1000, capMs: 60_000, random: () => 0.999 })).toBe(999)
	})

	it("grows exponentially and caps at capMs", () => {
		const at = (attempt: number) => backoffDelayMs(attempt, { baseMs: 1000, capMs: 5000, random: () => 1 })
		expect(at(0)).toBe(1000)
		expect(at(1)).toBe(2000)
		expect(at(2)).toBe(4000)
		expect(at(3)).toBe(5000)
		expect(at(10)).toBe(5000)
	})

	it("always stays within [raw/2, raw] (equal-jitter band)", () => {
		const baseMs = 1000
		const capMs = 60_000
		for (let attempt = 0; attempt < 12; attempt++) {
			const raw = Math.min(baseMs * 2 ** attempt, capMs)
			// Sweep several random draws per attempt.
			for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
				const delay = backoffDelayMs(attempt, { baseMs, capMs, random: () => r })
				expect(delay).toBeGreaterThanOrEqual(Math.floor(raw / 2))
				expect(delay).toBeLessThanOrEqual(raw)
			}
		}
	})

	it("produces different delays for different items (decorrelated retries)", () => {
		const random = seq([0, 0.5, 1, 0.25, 0.75, 0.1, 0.9, 0.4])
		const delays = Array.from({ length: 8 }, () => backoffDelayMs(0, { baseMs: 10_000, capMs: 60_000, random }))
		// With a spread-out random sequence the same-attempt delays differ.
		expect(new Set(delays).size).toBeGreaterThan(1)
	})
})
