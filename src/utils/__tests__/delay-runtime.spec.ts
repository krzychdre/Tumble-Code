// Runs the real `delay` package (most specs mock it) to pin what the product
// relies on: `await delay(ms)` resolves after `ms` under vitest fake timers
// (the timer is looked up at call time, not captured at import), a zero or
// negative delay resolves on the next tick, and a delay longer than the
// 32-bit timer limit (about 24.8 days) really waits instead of firing at once.
// The last case matters for the user-set `writeDelayMs` (DiagnosticsCollector),
// which has no upper bound.
import delay from "delay"

describe("delay", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("resolves only after the requested time", async () => {
		let done = false
		const pending = delay(300).then(() => {
			done = true
		})

		await vi.advanceTimersByTimeAsync(299)
		expect(done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		await pending
		expect(done).toBe(true)
	})

	it("resolves a zero delay without advancing the clock by a real amount", async () => {
		let done = false
		const pending = delay(0).then(() => {
			done = true
		})
		await vi.advanceTimersByTimeAsync(0)
		await pending
		expect(done).toBe(true)
	})

	it("does not fire at once when the delay exceeds the 32-bit timer limit", async () => {
		const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {})
		let done = false
		void delay(2 ** 31 + 1000).then(() => {
			done = true
		})

		await vi.advanceTimersByTimeAsync(10)
		expect(done).toBe(false)
		warn.mockRestore()
	})
})
