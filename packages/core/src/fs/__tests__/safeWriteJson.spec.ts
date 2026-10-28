// npx vitest run src/fs/__tests__/safeWriteJson.spec.ts
// The atomic replace itself (sync before rename, file mode, cleanup on failure) is covered by writeFileAtomic.spec.ts.

import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Writable } from "stream"

import * as lockfile from "proper-lockfile"

import { safeWriteJson, withLockedJsonTransaction, type LockedJsonWriter } from "../safeWriteJson.js"

vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
	return { ...actual, mkdir: vi.fn(actual.mkdir) }
})

vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return { ...actual, createWriteStream: vi.fn(actual.createWriteStream) }
})

/** Makes the next JSON stream fail on its first chunk. */
const failNextStream = (message: string) => {
	vi.mocked(fsSync.createWriteStream).mockImplementationOnce(() => {
		const stream = new Writable({ write: (_chunk, _encoding, callback) => callback(new Error(message)) })
		return stream as unknown as fsSync.WriteStream
	})
}

describe("safeWriteJson", () => {
	let tempDir: string
	let filePath: string

	const read = async (target = filePath) => fs.readFile(target, "utf-8")

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeWriteJson-test-"))
		filePath = path.join(tempDir, "test-file.json")
		await fs.writeFile(filePath, JSON.stringify({ initial: "content" }))
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("creates missing parent directories and replaces existing content", async () => {
		const deep = path.join(tempDir, "level1", "level2", "file.json")

		await safeWriteJson(deep, { nested: "deeply" })
		await safeWriteJson(filePath, { message: "updated" })

		expect(await read(deep)).toBe('{"nested":"deeply"}')
		expect(await read()).toBe('{"message":"updated"}')
	})

	it.each<[string, unknown, { prettyPrint?: boolean } | undefined, string]>([
		["tab-indented when asked", { a: [1] }, { prettyPrint: true }, '{\n\t"a": [\n\t\t1\n\t]\n}'],
		["undefined as null", undefined, undefined, "null"],
	])("writes %s", async (_name, data, options, expected) => {
		await safeWriteJson(filePath, data, options)

		expect(await read()).toBe(expected)
	})

	it.skipIf(process.platform === "win32")("gives the file the mode asked for", async () => {
		const fresh = path.join(tempDir, "fresh.json")
		await fs.chmod(filePath, 0o644)

		await safeWriteJson(fresh, { key: "secret" }, { mode: 0o600 })
		await safeWriteJson(filePath, { key: "secret" }, { mode: 0o600 })

		expect((await fs.stat(fresh)).mode & 0o777).toBe(0o600)
		expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
	})

	it("refuses to write while another process holds the lock", async () => {
		const release = await lockfile.lock(filePath, { realpath: false, retries: 0 })

		try {
			await expect(safeWriteJson(filePath, { locked: true })).rejects.toMatchObject({ code: "ELOCKED" })
		} finally {
			await release()
		}
		expect(await read()).toBe('{"initial":"content"}')
	})

	it("keeps the old content and releases the lock when streaming fails", async () => {
		failNextStream("Stream write error")

		await expect(safeWriteJson(filePath, { lost: true })).rejects.toThrow("Stream write error")
		expect(await read()).toBe('{"initial":"content"}')

		await safeWriteJson(filePath, { next: true })
		expect(await read()).toBe('{"next":true}')
	})

	it("reports a parent directory it cannot create", async () => {
		const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
		vi.mocked(fs.mkdir).mockRejectedValueOnce(denied)

		await expect(safeWriteJson(path.join(tempDir, "forbidden", "file.json"), {})).rejects.toBe(denied)
	})
})

describe("withLockedJsonTransaction", () => {
	let tempDir: string
	let destination: string
	let lockTarget: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lockedJson-test-"))
		destination = path.join(tempDir, "transaction.json")
		lockTarget = path.join(tempDir, "locks", "transaction.lock-target")
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		vi.doUnmock("proper-lockfile")
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	const lockIsFree = async () => {
		const release = await lockfile.lock(lockTarget, { realpath: false, retries: 0 })
		await release()
	}

	it("holds the lock during the callback, returns its result and refuses writes after it", async () => {
		let retained: LockedJsonWriter | undefined
		let competing: unknown

		const result = await withLockedJsonTransaction(lockTarget, destination, async (writeJson) => {
			retained = writeJson
			await writeJson({ transaction: true })
			competing = await lockIsFree().catch((error) => error)
			return "done"
		})

		expect(result).toBe("done")
		expect(competing).toMatchObject({ code: "ELOCKED" })
		await expect(retained!({ afterUnlock: true })).rejects.toThrow(
			"Locked JSON writer cannot be used after its transaction callback",
		)
		expect(await fs.readFile(destination, "utf-8")).toBe('{"transaction":true}')
		await lockIsFree()
	})

	it("waits for a write the callback did not await and reports its failure", async () => {
		failNextStream("unawaited write failed")

		await expect(
			withLockedJsonTransaction(lockTarget, destination, async (writeJson) => {
				void writeJson({ a: 1 }).catch(() => {})
				return "ignored"
			}),
		).rejects.toThrow("unawaited write failed")
		await lockIsFree()
	})

	it("rethrows a failing callback once its writes settled, and releases the lock", async () => {
		await expect(
			withLockedJsonTransaction(lockTarget, destination, async (writeJson) => {
				void writeJson({ written: true })
				throw new Error("callback failed")
			}),
		).rejects.toThrow("callback failed")

		expect(await fs.readFile(destination, "utf-8")).toBe('{"written":true}')
		await lockIsFree()
	})

	it("reports a compromised lock as LockCompromisedError without releasing it or throwing uncaught", async () => {
		vi.resetModules()
		const compromise = new Error("Lock was compromised by another process")
		const release = vi.fn()
		// proper-lockfile reports a compromise from its update timer, outside the caller's stack.
		vi.doMock("proper-lockfile", () => ({
			lock: vi.fn(async (_target: string, options: { onCompromised: (error: Error) => void }) => {
				setImmediate(() => options.onCompromised(compromise))
				await new Promise((resolve) => setImmediate(resolve))
				return release
			}),
		}))
		const fresh = await import("../safeWriteJson.js")
		const uncaught: unknown[] = []
		const onUncaught = (error: unknown) => uncaught.push(error)
		process.on("uncaughtException", onUncaught)

		try {
			const error = await fresh
				.withLockedJsonTransaction(lockTarget, destination, (writeJson) => writeJson({ compromised: true }))
				.catch((e) => e)

			expect(error).toBeInstanceOf(fresh.LockCompromisedError)
			expect(error.message).toContain("transaction.lock-target")
			expect(error.cause).toBe(compromise)
			expect(release).not.toHaveBeenCalled()
			expect(uncaught).toEqual([])
		} finally {
			process.off("uncaughtException", onUncaught)
		}
	})
})
