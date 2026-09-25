// Runs the real `workerpool` with a real worker thread (countTokens.spec mocks
// the module) to pin what utils/countTokens.ts relies on:
// - pool(script, { maxWorkers: 1, maxQueueSize: 10 }).exec(name, [content])
//   hands the content blocks to the worker and resolves with its answer;
// - a full queue throws synchronously with the message isQueueFullError knows;
// - a worker that crashes, or a script that cannot load, rejects with an Error
//   that isQueueFullError does NOT treat as back-pressure (the pool is dropped).
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"

import workerpool from "workerpool"

import { isQueueFullError } from "../countTokens"

const requireFromHere = createRequire(__filename)

let dir: string
let workerScript: string

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "countTokens-workerpool-"))
	workerScript = path.join(dir, "worker.cjs")
	fs.writeFileSync(
		workerScript,
		[
			`const workerpool = require(${JSON.stringify(requireFromHere.resolve("workerpool"))})`,
			"workerpool.worker({",
			"\tcountTokens: async (content) => ({ success: true, count: content.map((b) => b.text).join(' ').length }),",
			"\tslow: () => new Promise((resolve) => setTimeout(() => resolve('done'), 300)),",
			"\tcrash: () => process.exit(3),",
			"})",
		].join("\n"),
	)
})

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

describe("workerpool as used by countTokens", () => {
	it("runs the named method in a worker and returns its result", async () => {
		const pool = workerpool.pool(workerScript, { maxWorkers: 1, maxQueueSize: 10 })
		try {
			const content = [
				{ type: "text", text: "hello" },
				{ type: "text", text: "world" },
			]
			await expect(pool.exec("countTokens", [content])).resolves.toEqual({ success: true, count: 11 })
		} finally {
			await pool.terminate(true)
		}
	})

	it("throws the queue-full error synchronously once the queue is full", async () => {
		const pool = workerpool.pool(workerScript, { maxWorkers: 1, maxQueueSize: 1 })
		const pending = [pool.exec("slow", []), pool.exec("slow", [])]
		let thrown: unknown
		try {
			pending.push(pool.exec("slow", []))
		} catch (error) {
			thrown = error
		}
		try {
			expect(isQueueFullError(thrown)).toBe(true)
			expect((thrown as Error).message).toBe("Max queue size of 1 reached")
		} finally {
			await pool.terminate(true)
			await Promise.allSettled(pending)
		}
	})

	it("rejects with a non-back-pressure Error when the worker crashes", async () => {
		const pool = workerpool.pool(workerScript, { maxWorkers: 1, maxQueueSize: 10 })
		try {
			const error = await pool.exec("crash", []).then(
				() => undefined,
				(e: unknown) => e,
			)
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toMatch(/^Workerpool Worker terminated Unexpectedly/)
			expect((error as Error).message).toContain("exitCode: `3`")
			expect(isQueueFullError(error)).toBe(false)
		} finally {
			await pool.terminate(true)
		}
	})

	it("rejects with a non-back-pressure Error when the worker script does not exist", async () => {
		const pool = workerpool.pool(path.join(dir, "missing.js"), { maxWorkers: 1, maxQueueSize: 10 })
		try {
			const error = await pool.exec("countTokens", [[]]).then(
				() => undefined,
				(e: unknown) => e,
			)
			expect(error).toBeInstanceOf(Error)
			expect(isQueueFullError(error)).toBe(false)
		} finally {
			await pool.terminate(true)
		}
	})
})
