// npx vitest run core/task/__tests__/TaskApiLoop.abort-listener.spec.ts

import { raceNextChunkWithAbort } from "../TaskApiLoop"

describe("AP-5: raceNextChunkWithAbort listener cleanup", () => {
	it("should removeEventListener after each chunk resolves (no listener accumulation)", async () => {
		const chunkCount = 100
		const controller = new AbortController()
		const signal = controller.signal

		// Create an async iterator that yields chunkCount items
		let yielded = 0
		const iterator: AsyncIterator<string> = {
			next: async () => {
				if (yielded < chunkCount) {
					return { done: false, value: `chunk-${yielded++}` }
				}
				return { done: true, value: undefined as any }
			},
		}

		// Spy on addEventListener and removeEventListener
		const addSpy = vi.spyOn(signal, "addEventListener")
		const removeSpy = vi.spyOn(signal, "removeEventListener")

		// Process all chunks through raceNextChunkWithAbort
		let done = false
		while (!done) {
			const result = await raceNextChunkWithAbort(iterator, signal)
			if (result.done) {
				done = true
			}
		}

		// AP-5: every addEventListener call must have a matching removeEventListener
		const addCalls = addSpy.mock.calls.filter((call) => call[0] === "abort")
		const removeCalls = removeSpy.mock.calls.filter((call) => call[0] === "abort")

		expect(addCalls.length).toBeGreaterThan(0)
		expect(removeCalls.length).toBe(addCalls.length)
	})

	it("should use { once: true } on addEventListener", async () => {
		const controller = new AbortController()
		const signal = controller.signal

		const iterator: AsyncIterator<string> = {
			next: async () => ({ done: false, value: "test" }),
		}

		const addSpy = vi.spyOn(signal, "addEventListener")

		// Process one chunk
		await raceNextChunkWithAbort(iterator, signal)

		// AP-5: addEventListener should be called with { once: true }
		const abortCall = addSpy.mock.calls.find((call) => call[0] === "abort")
		expect(abortCall).toBeDefined()
		expect(abortCall![2]).toEqual({ once: true })
	})

	it("should reject immediately if signal is already aborted (no listener added)", async () => {
		const controller = new AbortController()
		controller.abort()
		const signal = controller.signal

		const iterator: AsyncIterator<string> = {
			next: async () => ({ done: false, value: "test" }),
		}

		const addSpy = vi.spyOn(signal, "addEventListener")

		await expect(raceNextChunkWithAbort(iterator, signal)).rejects.toThrow("Request cancelled by user")

		// No listener should have been added since signal was already aborted
		const abortCalls = addSpy.mock.calls.filter((call) => call[0] === "abort")
		expect(abortCalls).toHaveLength(0)
	})

	it("should clean up listener even when iterator throws", async () => {
		const controller = new AbortController()
		const signal = controller.signal

		const iterator: AsyncIterator<string> = {
			next: async () => {
				throw new Error("iterator error")
			},
		}

		const addSpy = vi.spyOn(signal, "addEventListener")
		const removeSpy = vi.spyOn(signal, "removeEventListener")

		await expect(raceNextChunkWithAbort(iterator, signal)).rejects.toThrow("iterator error")

		const addCalls = addSpy.mock.calls.filter((call) => call[0] === "abort")
		const removeCalls = removeSpy.mock.calls.filter((call) => call[0] === "abort")

		// Listener should still be cleaned up even on error
		expect(addCalls.length).toBe(1)
		expect(removeCalls.length).toBe(1)
	})
})
