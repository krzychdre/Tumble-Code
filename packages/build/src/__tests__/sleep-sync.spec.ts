// npx vitest run src/__tests__/sleep-sync.spec.ts

import { sleepSync } from "../sleep-sync.js"

describe("sleepSync", () => {
	it("blocks for at least the requested time", () => {
		const start = performance.now()
		sleepSync(30)
		// Allow a little timer slack below the nominal value.
		expect(performance.now() - start).toBeGreaterThanOrEqual(25)
	})

	it("does not poll the clock while waiting", () => {
		const now = vi.spyOn(Date, "now")
		sleepSync(5)
		expect(now).not.toHaveBeenCalled()
		now.mockRestore()
	})

	it("returns at once for zero, negative and NaN durations", () => {
		const start = performance.now()
		sleepSync(0)
		sleepSync(-10)
		sleepSync(Number.NaN)
		expect(performance.now() - start).toBeLessThan(20)
	})
})
