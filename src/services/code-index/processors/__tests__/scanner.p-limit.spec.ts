// Runs the real `p-limit` (no module mock) and pins the contract the directory
// scanner relies on (scanner.ts: parseLimiter and batchLimiter): no more than
// the configured number of jobs run at once, every job's result reaches its
// own caller, and a rejected job neither stops the queue nor leaks into the
// other callers.
import pLimit from "p-limit"

describe("p-limit as used by the code-index scanner", () => {
	it("runs at most `concurrency` jobs at once and returns every result", async () => {
		const limit = pLimit(2)
		let running = 0
		let peak = 0
		const job = (value: number) =>
			limit(async () => {
				running++
				peak = Math.max(peak, running)
				await new Promise((resolve) => setTimeout(resolve, 5))
				running--
				return value * 10
			})

		const results = await Promise.all([1, 2, 3, 4, 5].map(job))

		expect(results).toEqual([10, 20, 30, 40, 50])
		expect(peak).toBe(2)
		expect(limit.activeCount).toBe(0)
		expect(limit.pendingCount).toBe(0)
	})

	it("keeps draining the queue after a job rejects", async () => {
		const limit = pLimit(1)
		const outcomes = await Promise.allSettled([
			limit(async () => "a"),
			limit(async () => {
				throw new Error("parse failed")
			}),
			limit(async () => "c"),
		])

		expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "rejected", "fulfilled"])
		expect((outcomes[1] as PromiseRejectedResult).reason.message).toBe("parse failed")
		expect((outcomes[2] as PromiseFulfilledResult<string>).value).toBe("c")
	})
})
