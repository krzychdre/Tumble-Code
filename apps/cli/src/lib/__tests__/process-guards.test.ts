/**
 * Unit tests for the shared process guards (R6). Handlers are exercised
 * through a fake ProcessLike target and injected onExit, so nothing actually
 * kills the vitest worker process.
 */

import { installProcessGuards, type ProcessLike } from "../process-guards.js"

interface FakeProcess extends ProcessLike {
	emit(event: string, ...args: unknown[]): void
	listeners(event: string): ((...args: unknown[]) => void)[]
}

function createFakeProcess(): FakeProcess {
	const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

	return {
		on(event, listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener as (...args: unknown[]) => void])
		},
		off(event, listener) {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((l) => l !== listener),
			)
		},
		emit(event, ...args) {
			for (const listener of [...(listeners.get(event) ?? [])]) {
				listener(...args)
			}
		},
		listeners(event) {
			return [...(listeners.get(event) ?? [])]
		},
	}
}

function setup(overrides: Partial<Parameters<typeof installProcessGuards>[0]> = {}) {
	const target = createFakeProcess()
	const onCleanup = vi.fn(async () => {})
	const onExit = vi.fn()
	const onError = vi.fn()

	const dispose = installProcessGuards({
		onCleanup,
		onError,
		onExit,
		exitTimeoutMs: 0,
		target,
		...overrides,
	})

	return { target, onCleanup, onExit, onError, dispose }
}

/** Guards are async (cleanup runs before exit); let the microtasks drain. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("installProcessGuards", () => {
	it("installs all four handlers and dispose removes them", () => {
		const { target, dispose } = setup()

		for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]) {
			expect(target.listeners(event)).toHaveLength(1)
		}

		dispose()

		for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]) {
			expect(target.listeners(event)).toHaveLength(0)
		}
	})

	it("SIGINT runs cleanup once and exits 130", async () => {
		const { target, onCleanup, onExit } = setup()

		target.emit("SIGINT")
		// A second signal while the first shutdown is in flight must not
		// re-run cleanup.
		target.emit("SIGINT")
		await flush()

		expect(onCleanup).toHaveBeenCalledTimes(1)
		expect(onExit).toHaveBeenCalledWith(130)
	})

	it("SIGTERM exits 143", async () => {
		const { target, onExit } = setup()

		target.emit("SIGTERM")
		await flush()

		expect(onExit).toHaveBeenCalledWith(143)
	})

	it("uncaughtException reports the error and exits 1", async () => {
		const { target, onExit, onError } = setup()

		target.emit("uncaughtException", new Error("boom"))
		await flush()

		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }), "uncaughtException")
		expect(onExit).toHaveBeenCalledWith(1)
	})

	it("unhandledRejection reports the reason and exits 1", async () => {
		const { target, onExit, onError } = setup()

		target.emit("unhandledRejection", "nope")
		await flush()

		expect(onError).toHaveBeenCalledWith("nope", "unhandledRejection")
		expect(onExit).toHaveBeenCalledWith(1)
	})

	it("cleanup that throws is reported and the process still exits", async () => {
		const { target, onExit, onError } = setup({
			onCleanup: async () => {
				throw new Error("cleanup failed")
			},
		})

		target.emit("SIGTERM")
		await flush()

		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "cleanup failed" }), "SIGTERM")
		expect(onExit).toHaveBeenCalledWith(143)
	})

	it("dispose runs the cleanup pass once and later guards are no-ops", async () => {
		const { target, onCleanup, onExit, dispose } = setup()

		await dispose()

		expect(onCleanup).toHaveBeenCalledTimes(1)

		target.emit("SIGINT")
		target.emit("uncaughtException", new Error("late"))
		await flush()

		// Handlers are removed and cleanup is idempotent.
		expect(onCleanup).toHaveBeenCalledTimes(1)
		expect(onExit).not.toHaveBeenCalled()
	})

	it("cleanup is idempotent when a guard fires twice and dispose follows", async () => {
		const { target, onCleanup, dispose } = setup()
		void dispose

		target.emit("uncaughtException", new Error("boom"))
		await dispose()

		expect(onCleanup).toHaveBeenCalledTimes(1)
	})

	it("the exit timeout force-exits when cleanup hangs", async () => {
		vi.useFakeTimers()
		try {
			const { target, onExit } = setup({
				onCleanup: () => new Promise<void>(() => {}),
				exitTimeoutMs: 5_000,
			})

			target.emit("SIGINT")
			vi.advanceTimersByTime(5_000)

			expect(onExit).toHaveBeenCalledWith(130)
		} finally {
			vi.useRealTimers()
		}
	})
})
