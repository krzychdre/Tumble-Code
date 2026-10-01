// npx vitest run src/fs/__tests__/writeFileAtomic.spec.ts

import * as os from "os"
import * as path from "path"

vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename), open: vi.fn(actual.open) }
})

import * as fs from "fs/promises"

import { writeFileAtomic } from "../writeFileAtomic.js"

describe("writeFileAtomic", () => {
	let dir: string
	let target: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "write-file-atomic-"))
		target = path.join(dir, "data.txt")
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	const entries = () => fs.readdir(dir)

	it("writes a new file and leaves nothing else in the directory", async () => {
		await writeFileAtomic(target, "hello")

		expect(await fs.readFile(target, "utf8")).toBe("hello")
		expect(await entries()).toEqual(["data.txt"])
	})

	it("replaces an existing file with string or binary data", async () => {
		await fs.writeFile(target, "old")

		await writeFileAtomic(target, Buffer.from("new bytes"))

		expect(await fs.readFile(target, "utf8")).toBe("new bytes")
	})

	it("does not create the parent directory", async () => {
		await expect(writeFileAtomic(path.join(dir, "missing", "data.txt"), "x")).rejects.toMatchObject({
			code: "ENOENT",
		})
	})

	describe.runIf(process.platform !== "win32")("file mode", () => {
		it("gives a new file the default mode", async () => {
			await writeFileAtomic(target, "x")

			expect((await fs.stat(target)).mode & 0o777).toBe(0o666 & ~process.umask())
		})

		it("keeps the mode of the file it replaces", async () => {
			await fs.writeFile(target, "old")
			await fs.chmod(target, 0o640)

			await writeFileAtomic(target, "new")

			expect((await fs.stat(target)).mode & 0o777).toBe(0o640)
		})

		it("applies an explicit mode exactly, to new and replaced files", async () => {
			await writeFileAtomic(target, "x", { mode: 0o600 })
			expect((await fs.stat(target)).mode & 0o777).toBe(0o600)

			await fs.chmod(target, 0o644)
			await writeFileAtomic(target, "y", { mode: 0o755 })
			expect((await fs.stat(target)).mode & 0o777).toBe(0o755)
		})
	})

	describe("on failure", () => {
		it("keeps the old content and leaves no partial or temporary file when the write fails midway", async () => {
			await fs.writeFile(target, "previous content")
			const { writeFile: realWriteFile } = await vi.importActual<typeof import("fs/promises")>("fs/promises")
			vi.mocked(fs.writeFile).mockImplementationOnce(async (file, data, options) => {
				// Part of the bytes reach the disk, then the device fills up.
				await realWriteFile(file, String(data).slice(0, 3), options)
				throw new Error("ENOSPC: no space left on device")
			})

			await expect(writeFileAtomic(target, "replacement content")).rejects.toThrow("ENOSPC")

			expect(await fs.readFile(target, "utf8")).toBe("previous content")
			expect(await entries()).toEqual(["data.txt"])
		})

		it("creates no file under the name when a new file cannot be written", async () => {
			vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("EIO: i/o error"))

			await expect(writeFileAtomic(target, "content")).rejects.toThrow("EIO")

			expect(await entries()).toEqual([])
		})

		it("keeps the old content and removes the temporary file when the rename fails", async () => {
			await fs.writeFile(target, "previous content")

			await expect(
				writeFileAtomic(target, "replacement", {
					rename: async () => Promise.reject(new Error("simulated rename failure")),
				}),
			).rejects.toThrow("simulated rename failure")

			expect(await fs.readFile(target, "utf8")).toBe("previous content")
			expect(await entries()).toEqual(["data.txt"])
		})
	})

	it("syncs the temporary file to disk before renaming it over the target", async () => {
		const events: string[] = []
		const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
		vi.mocked(fs.open).mockImplementationOnce((async (...args: Parameters<typeof actual.open>) => {
			const handle = await actual.open(...args)
			const sync = handle.sync.bind(handle)
			handle.sync = async () => {
				events.push(`sync ${path.basename(String(args[0]))}`)
				return sync()
			}
			return handle
		}) as typeof actual.open)

		await writeFileAtomic(target, "durable", {
			rename: async (source, destination) => {
				events.push(`rename ${path.basename(source)}`)
				await actual.rename(source, destination)
			},
		})

		expect(events).toHaveLength(2)
		expect(events[0]).toBe(events[1]!.replace("rename", "sync"))
		expect(events[1]).toMatch(/^rename \.data\.txt\..+\.tmp$/)
		expect(await fs.readFile(target, "utf8")).toBe("durable")
	})
})
