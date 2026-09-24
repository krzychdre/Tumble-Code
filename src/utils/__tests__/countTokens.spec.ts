// npx vitest run utils/__tests__/countTokens.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

const { execMock, poolFactoryMock, tiktokenMock } = vi.hoisted(() => {
	const execMock = vi.fn()
	const poolFactoryMock = vi.fn(() => ({ exec: execMock }))
	const tiktokenMock = vi.fn()
	return { execMock, poolFactoryMock, tiktokenMock }
})

vi.mock("workerpool", () => ({
	default: { pool: poolFactoryMock },
}))

vi.mock("../tiktoken", () => ({
	tiktoken: tiktokenMock,
}))

const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "hello world" }]

// The exact errors workerpool 9.x produces, see node_modules/workerpool/src/Pool.js (exec)
// and src/WorkerHandler.js (the worker "exit" listener).
const queueFullError = () => new Error("Max queue size of 10 reached")
const workerCrashError = () =>
	new Error("Workerpool Worker terminated Unexpectedly\n    exitCode: `1`\n    signalCode: `null`\n")

// Pool.exec throws the queue-full error synchronously, before it returns a promise.
const throwQueueFull = () => {
	throw queueFullError()
}

async function loadCountTokens() {
	// The pool lives in module state, so every test gets a fresh module.
	vi.resetModules()
	return import("../countTokens")
}

describe("countTokens worker pool", () => {
	beforeEach(() => {
		execMock.mockReset()
		poolFactoryMock.mockClear()
		tiktokenMock.mockReset()
		tiktokenMock.mockResolvedValue(7)
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("uses the worker pool when it answers", async () => {
		const { countTokens } = await loadCountTokens()
		execMock.mockResolvedValue({ success: true, count: 42 })

		await expect(countTokens(content)).resolves.toBe(42)
		expect(execMock).toHaveBeenCalledTimes(1)
		expect(tiktokenMock).not.toHaveBeenCalled()
	})

	it("counts inline on a full queue and keeps using the pool afterwards", async () => {
		const { countTokens } = await loadCountTokens()
		execMock.mockImplementationOnce(throwQueueFull).mockResolvedValue({ success: true, count: 42 })

		// The rejected call still gets a correct count, from the inline fallback.
		await expect(countTokens(content)).resolves.toBe(7)
		expect(tiktokenMock).toHaveBeenCalledTimes(1)

		// Back-pressure is transient: the next calls go through the pool again.
		await expect(countTokens(content)).resolves.toBe(42)
		await expect(countTokens(content)).resolves.toBe(42)
		expect(execMock).toHaveBeenCalledTimes(3)
		expect(tiktokenMock).toHaveBeenCalledTimes(1)
		expect(poolFactoryMock).toHaveBeenCalledTimes(1)
	})

	it("survives repeated queue-full bursts without ever disabling the pool", async () => {
		const { countTokens } = await loadCountTokens()
		execMock
			.mockImplementationOnce(throwQueueFull)
			.mockImplementationOnce(throwQueueFull)
			.mockImplementationOnce(throwQueueFull)
			.mockResolvedValue({ success: true, count: 42 })

		for (let i = 0; i < 3; i++) {
			await expect(countTokens(content)).resolves.toBe(7)
		}

		await expect(countTokens(content)).resolves.toBe(42)
		expect(execMock).toHaveBeenCalledTimes(4)
	})

	it("disables the pool for the session after a real worker crash", async () => {
		const { countTokens } = await loadCountTokens()
		execMock.mockRejectedValueOnce(workerCrashError()).mockResolvedValue({ success: true, count: 42 })

		await expect(countTokens(content)).resolves.toBe(7)
		await expect(countTokens(content)).resolves.toBe(7)

		expect(execMock).toHaveBeenCalledTimes(1)
		expect(tiktokenMock).toHaveBeenCalledTimes(2)
		expect(poolFactoryMock).toHaveBeenCalledTimes(1)
	})

	it("counts inline without touching the pool when useWorker is false", async () => {
		const { countTokens } = await loadCountTokens()

		await expect(countTokens(content, { useWorker: false })).resolves.toBe(7)
		expect(poolFactoryMock).not.toHaveBeenCalled()
		expect(execMock).not.toHaveBeenCalled()
	})
})

describe("isQueueFullError", () => {
	it("recognizes the error the installed workerpool throws on a full queue", async () => {
		const { isQueueFullError } = await loadCountTokens()
		const actual = await vi.importActual<{ default: typeof import("workerpool") }>("workerpool")

		// One worker and a queue of one: the first task goes to the worker, the
		// second waits in the queue, the third must be rejected.
		const realPool = actual.default.pool({ maxWorkers: 1, maxQueueSize: 1 })
		const slow = () => new Promise((resolve) => setTimeout(resolve, 200))
		const pending = [realPool.exec(slow, []), realPool.exec(slow, [])]

		let thrown: unknown
		try {
			pending.push(realPool.exec(slow, []))
		} catch (error) {
			thrown = error
		}

		try {
			expect(thrown).toBeInstanceOf(Error)
			expect(isQueueFullError(thrown)).toBe(true)
		} finally {
			await realPool.terminate(true)
			await Promise.allSettled(pending)
		}
	})

	it("does not treat a worker crash or other failures as back-pressure", async () => {
		const { isQueueFullError } = await loadCountTokens()

		expect(isQueueFullError(workerCrashError())).toBe(false)
		expect(isQueueFullError(new Error("Worker is terminated"))).toBe(false)
		expect(isQueueFullError("Max queue size of 10 reached")).toBe(false)
		expect(isQueueFullError(undefined)).toBe(false)
	})
})
