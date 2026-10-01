// npx vitest run extension/__tests__/cloudStartup.spec.ts

async function freshModule() {
	vi.resetModules()
	return import("../cloudStartup")
}

function deferred() {
	let resolve: () => void = () => {}
	let reject: (error: unknown) => void = () => {}
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("cloudStartup (P9)", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not make anyone wait when no start was made", async () => {
		const { waitForCloudStart } = await freshModule()

		await expect(waitForCloudStart()).resolves.toBeUndefined()
	})

	it("returns at once, holds waiters until the start settles, then releases them", async () => {
		const { startCloudInBackground, waitForCloudStart } = await freshModule()
		const start = deferred()
		const log = vi.fn()

		const done = startCloudInBackground(() => start.promise, log)

		let released = false
		void waitForCloudStart().then(() => {
			released = true
		})
		await Promise.resolve()
		expect(released).toBe(false)

		start.resolve()
		await done

		await waitForCloudStart()
		expect(released).toBe(true)
		expect(log).not.toHaveBeenCalled()
	})

	it("logs a failed start instead of rejecting", async () => {
		const { startCloudInBackground, waitForCloudStart } = await freshModule()
		const log = vi.fn()

		await expect(
			startCloudInBackground(() => Promise.reject(new Error("keyring locked")), log),
		).resolves.toBeUndefined()

		await expect(waitForCloudStart()).resolves.toBeUndefined()
		expect(log).toHaveBeenCalledWith("[CloudService] background start failed: keyring locked")
	})

	it("releases waiters at the timeout and still finishes later", async () => {
		vi.useFakeTimers()
		const { startCloudInBackground, waitForCloudStart } = await freshModule()
		const start = deferred()
		const log = vi.fn()
		const finishedLate = vi.fn()

		const done = startCloudInBackground(
			async () => {
				await start.promise
				finishedLate()
			},
			log,
			5_000,
		)
		let released = false
		void waitForCloudStart().then(() => {
			released = true
		})

		await vi.advanceTimersByTimeAsync(4_999)
		expect(released).toBe(false)

		await vi.advanceTimersByTimeAsync(1)
		expect(released).toBe(true)
		expect(log).toHaveBeenCalledWith(expect.stringContaining("[CloudService] still starting after 5 s"))
		expect(finishedLate).not.toHaveBeenCalled()

		start.resolve()
		await done
		expect(finishedLate).toHaveBeenCalledTimes(1)
	})

	it("does not log the timeout when the start settled first", async () => {
		vi.useFakeTimers()
		const { startCloudInBackground } = await freshModule()
		const log = vi.fn()

		await startCloudInBackground(() => Promise.resolve(), log, 5_000)
		await vi.advanceTimersByTimeAsync(10_000)

		expect(log).not.toHaveBeenCalled()
	})
})
