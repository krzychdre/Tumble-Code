import { backoffDelayMs, backoffDelayMsNoJitter, countdown } from "../backoff.js"

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

describe("backoffDelayMsNoJitter (exact ladder)", () => {
	it("doubles from the base on every attempt", () => {
		expect(backoffDelayMsNoJitter(0, { baseMs: 500, capMs: 60_000 })).toBe(500)
		expect(backoffDelayMsNoJitter(1, { baseMs: 500, capMs: 60_000 })).toBe(1000)
		expect(backoffDelayMsNoJitter(2, { baseMs: 500, capMs: 60_000 })).toBe(2000)
		expect(backoffDelayMsNoJitter(3, { baseMs: 500, capMs: 60_000 })).toBe(4000)
	})

	it("never exceeds the cap", () => {
		expect(backoffDelayMsNoJitter(7, { baseMs: 5_000, capMs: 300_000 })).toBe(300_000)
		expect(backoffDelayMsNoJitter(20, { baseMs: 5_000, capMs: 300_000 })).toBe(300_000)
	})

	it("is deterministic: no random source involved", () => {
		expect(backoffDelayMsNoJitter(2, { baseMs: 1_000, capMs: 10_000 })).toBe(4_000)
	})
})

describe("countdown", () => {
	it("ticks every second from `seconds` down to 1, then resolves", async () => {
		const ticks: number[] = []
		await countdown(3, { onTick: (i) => void ticks.push(i), sleep: () => Promise.resolve() })
		expect(ticks).toEqual([3, 2, 1])
	})

	it("resolves immediately for zero seconds", async () => {
		const onTick = vi.fn()
		await countdown(0, { onTick, sleep: () => Promise.resolve() })
		expect(onTick).not.toHaveBeenCalled()
	})

	it("awaits an async onTick before sleeping", async () => {
		const order: string[] = []
		await countdown(2, {
			onTick: async (i) => {
				order.push(`tick${i}`)
			},
			sleep: async () => {
				order.push("sleep")
			},
		})
		expect(order).toEqual(["tick2", "sleep", "tick1", "sleep"])
	})

	it("rejects with the abort error when isAborted() turns true before a tick", async () => {
		let aborted = false
		const ticks: number[] = []
		const error = new Error("custom abort")
		await expect(
			countdown(5, {
				onTick: (i) => void ticks.push(i),
				isAborted: () => aborted,
				abortError: error,
				sleep: async () => {
					// Abort while sleeping after the first tick.
					aborted = true
				},
			}),
		).rejects.toBe(error)
		expect(ticks).toEqual([5])
	})

	it("rejects before the first tick when already aborted", async () => {
		const onTick = vi.fn()
		await expect(
			countdown(3, {
				onTick,
				isAborted: () => true,
				sleep: () => Promise.resolve(),
			}),
		).rejects.toThrow("Countdown aborted")
		expect(onTick).not.toHaveBeenCalled()
	})

	it("uses the default setTimeout sleep with the step duration (fake timers)", async () => {
		vi.useFakeTimers()
		try {
			const ticks: number[] = []
			const done = countdown(2, { onTick: (i) => void ticks.push(i), stepMs: 1000 })
			await vi.advanceTimersByTimeAsync(0)
			expect(ticks).toEqual([2])
			await vi.advanceTimersByTimeAsync(1000)
			expect(ticks).toEqual([2, 1])
			await vi.advanceTimersByTimeAsync(1000)
			await done
			expect(ticks).toEqual([2, 1])
		} finally {
			vi.useRealTimers()
		}
	})
})
