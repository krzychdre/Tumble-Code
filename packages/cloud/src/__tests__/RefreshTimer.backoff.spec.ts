// npx vitest run src/__tests__/RefreshTimer.backoff.spec.ts

import type { Mock } from "vitest"

import { RefreshTimer } from "../RefreshTimer.js"

vi.useFakeTimers()

// R11: the failure backoff carries equal jitter so many clients that start in
// sync (VS Code reload, backend restart) do not all retry on the same tick.

describe("RefreshTimer backoff jitter (R11)", () => {
	let mockCallback: Mock
	let refreshTimer: RefreshTimer

	afterEach(() => {
		if (refreshTimer) refreshTimer.stop()
		vi.clearAllTimers()
		vi.clearAllMocks()
	})

	it("schedules the first failure after half the base backoff when random()=0", async () => {
		const random = vi.fn(() => 0)
		mockCallback = vi.fn().mockResolvedValue(false)
		refreshTimer = new RefreshTimer({ callback: mockCallback, initialBackoffMs: 1000, random })
		refreshTimer.start()
		await Promise.resolve() // first attempt fails

		expect(mockCallback).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(499)
		expect(mockCallback).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(mockCallback).toHaveBeenCalledTimes(2) // fired at exactly 500 ms
	})

	it("schedules the first failure after nearly the full base backoff when random()≈1", async () => {
		const random = vi.fn(() => 0.999)
		mockCallback = vi.fn().mockResolvedValue(false)
		refreshTimer = new RefreshTimer({ callback: mockCallback, initialBackoffMs: 1000, random })
		refreshTimer.start()
		await Promise.resolve()

		await vi.advanceTimersByTimeAsync(998)
		expect(mockCallback).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(mockCallback).toHaveBeenCalledTimes(2) // fired at 999 ms, not before
	})

	it("keeps the exponential shape across attempts (1 s band, 2 s band, 4 s band)", async () => {
		const random = vi.fn(() => 1) // top of each jitter band
		mockCallback = vi.fn().mockResolvedValue(false)
		refreshTimer = new RefreshTimer({ callback: mockCallback, initialBackoffMs: 1000, maxBackoffMs: 5000, random })
		refreshTimer.start()
		await Promise.resolve()

		// Attempt 1 → delay band [500, 1000]
		await vi.advanceTimersByTimeAsync(1000)
		expect(mockCallback).toHaveBeenCalledTimes(2)
		// Attempt 2 → delay band [1000, 2000]
		await vi.advanceTimersByTimeAsync(2000)
		expect(mockCallback).toHaveBeenCalledTimes(3)
		// Attempt 3 → delay band [2000, 4000]
		await vi.advanceTimersByTimeAsync(4000)
		expect(mockCallback).toHaveBeenCalledTimes(4)
		// Attempt 4 → delay band [4000, 5000] (capped)
		await vi.advanceTimersByTimeAsync(5000)
		expect(mockCallback).toHaveBeenCalledTimes(5)
	})

	it("two timers with different random sources do not fire on the same tick", async () => {
		const cb = vi.fn().mockResolvedValue(false)
		const fast = new RefreshTimer({ callback: cb, initialBackoffMs: 1000, random: () => 0 })
		const slow = new RefreshTimer({ callback: cb, initialBackoffMs: 1000, random: () => 0.999 })

		fast.start()
		slow.start()
		await Promise.resolve()

		// fast fires its retry at 500 ms; slow waits until 999 ms.
		await vi.advanceTimersByTimeAsync(500)
		expect(cb).toHaveBeenCalledTimes(3) // 2 immediate starts + fast's retry
		await vi.advanceTimersByTimeAsync(498)
		expect(cb).toHaveBeenCalledTimes(3) // slow has not fired yet
		await vi.advanceTimersByTimeAsync(1)
		expect(cb).toHaveBeenCalledTimes(4) // now slow fired too

		fast.stop()
		slow.stop()
	})
})
