import { describe, it, expect } from "vitest"

import { SlotWaitAbortedError, SubagentSlotPool } from "../SubagentSlotPool"

/** Let pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("SubagentSlotPool", () => {
	it("grants slots up to the global limit, then queues", async () => {
		const pool = new SubagentSlotPool()
		const granted: string[] = []
		for (const name of ["a", "b", "c"]) {
			void pool.acquire({ globalLimit: 2 }).then(() => granted.push(name))
		}
		await flush()
		expect(granted).toEqual(["a", "b"])
		expect(pool.running).toBe(2)
		expect(pool.waiting).toBe(1)
	})

	it("serves waiters first in, first out as slots free up", async () => {
		const pool = new SubagentSlotPool()
		const releaseFirst = await pool.acquire({ globalLimit: 1 })
		const order: string[] = []
		const second = pool.acquire({ globalLimit: 1 }).then((release) => {
			order.push("second")
			return release
		})
		const third = pool.acquire({ globalLimit: 1 }).then((release) => {
			order.push("third")
			return release
		})
		await flush()
		expect(order).toEqual([])

		releaseFirst()
		;(await second)()
		;(await third)()
		expect(order).toEqual(["second", "third"])
		expect(pool.running).toBe(0)
	})

	// Two fan-outs share one pool: together they never exceed the cap.
	it("bounds two fan-outs together, not each on its own", async () => {
		const pool = new SubagentSlotPool()
		let active = 0
		let peak = 0
		const job = async () => {
			const release = await pool.acquire({ globalLimit: 3 })
			active++
			peak = Math.max(peak, active)
			await new Promise((resolve) => setTimeout(resolve, 5))
			active--
			release()
		}
		const fanOutA = Promise.all([job(), job(), job()])
		const fanOutB = Promise.all([job(), job(), job()])
		await Promise.all([fanOutA, fanOutB])
		expect(peak).toBe(3)
	})

	it("a release called twice frees one slot only", async () => {
		const pool = new SubagentSlotPool()
		const release = await pool.acquire({ globalLimit: 2 })
		await pool.acquire({ globalLimit: 2 })
		release()
		release()
		expect(pool.running).toBe(1)
	})

	it("an aborted waiter leaves the queue and rejects", async () => {
		const pool = new SubagentSlotPool()
		const release = await pool.acquire({ globalLimit: 1 })
		const controller = new AbortController()
		const waiting = pool.acquire({ globalLimit: 1 }, controller.signal)
		controller.abort()
		await expect(waiting).rejects.toBeInstanceOf(SlotWaitAbortedError)
		expect(pool.waiting).toBe(0)

		release()
		expect(pool.running).toBe(0)
		await expect(pool.acquire({ globalLimit: 1 }, controller.signal)).rejects.toBeInstanceOf(SlotWaitAbortedError)
	})

	it("treats a limit below 1 as 1, so a subagent can always start", async () => {
		const pool = new SubagentSlotPool()
		await pool.acquire({ globalLimit: 0 })
		expect(pool.running).toBe(1)
	})
})
