import { makeSideQuery } from "../memoryTaskIntegration"
import type { ApiHandler, SingleCompletionHandler } from "../../../api"

/**
 * MEM-4: makeSideQuery must not leave an unhandled rejection when abort wins
 * the Promise.race and the completion promise later rejects.
 */
describe("makeSideQuery", () => {
	it("returns undefined when handler has no completePrompt method", () => {
		const handler = {} as ApiHandler
		expect(makeSideQuery(handler)).toBeUndefined()
	})

	it("returns a SideQuery function when handler has completePrompt", () => {
		const handler = { completePrompt: vi.fn() } as unknown as ApiHandler
		expect(typeof makeSideQuery(handler)).toBe("function")
	})

	it("throws 'aborted' when signal is already aborted", async () => {
		const handler = {
			completePrompt: vi.fn(async () => "ok"),
		} as unknown as ApiHandler & SingleCompletionHandler
		const sideQuery = makeSideQuery(handler)!
		const controller = new AbortController()
		controller.abort()
		await expect(sideQuery("sys", "usr", controller.signal)).rejects.toThrow("aborted")
	})

	it("returns the completion result when not aborted", async () => {
		const handler = {
			completePrompt: vi.fn(async () => "result text"),
		} as unknown as ApiHandler & SingleCompletionHandler
		const sideQuery = makeSideQuery(handler)!
		const result = await sideQuery("sys", "usr", new AbortController().signal)
		expect(result).toBe("result text")
	})

	it("propagates completion rejection when abort is not fired", async () => {
		const handler = {
			completePrompt: vi.fn(async () => {
				throw new Error("network error")
			}),
		} as unknown as ApiHandler & SingleCompletionHandler
		const sideQuery = makeSideQuery(handler)!
		// Signal not aborted — completion rejection should propagate.
		await expect(sideQuery("sys", "usr", new AbortController().signal)).rejects.toThrow("network error")
	})

	it("does NOT emit unhandledRejection when abort wins and completion later rejects", async () => {
		// completePrompt resolves/rejects 100ms after being called.
		const handler = {
			completePrompt: vi.fn(
				() =>
					new Promise<string>((_resolve, reject) => {
						setTimeout(() => reject(new Error("late network error")), 100)
					}),
			),
		} as unknown as ApiHandler & SingleCompletionHandler
		const sideQuery = makeSideQuery(handler)!

		const controller = new AbortController()

		// Hook unhandledRejection to detect the bug.
		const rejections: unknown[] = []
		const onUnhandledRejection = (reason: unknown) => {
			rejections.push(reason)
		}
		process.on("unhandledRejection", onUnhandledRejection)

		try {
			// Abort almost immediately — abort wins the race.
			setTimeout(() => controller.abort(), 5)
			await expect(sideQuery("sys", "usr", controller.signal)).rejects.toThrow("aborted")
			// Wait long enough for the late completion rejection to fire.
			await new Promise((r) => setTimeout(r, 200))
			expect(rejections).toHaveLength(0)
		} finally {
			process.off("unhandledRejection", onUnhandledRejection)
		}
	})
})
