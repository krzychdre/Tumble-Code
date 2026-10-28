import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import { writePrivateFileSync } from "../utils/privateFile.js"

describe("writePrivateFileSync", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "private-file-test-"))
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it.skipIf(process.platform === "win32")("creates a file only its owner can read", () => {
		const target = path.join(tempDir, "secrets.json")

		writePrivateFileSync(target, '{"k":"v"}')

		expect(fs.readFileSync(target, "utf-8")).toBe('{"k":"v"}')
		expect(fs.statSync(target).mode & 0o777).toBe(0o600)
	})

	it.skipIf(process.platform === "win32")(
		"never writes the content into a file an older version left readable by all",
		() => {
			const target = path.join(tempDir, "secrets.json")
			fs.writeFileSync(target, "{}")
			fs.chmodSync(target, 0o644)
			const readableInode = fs.statSync(target).ino

			writePrivateFileSync(target, '{"token":"secret"}')

			// The new content arrived in another file, which replaced the readable one.
			const written = fs.statSync(target)
			expect(written.ino).not.toBe(readableInode)
			expect(written.mode & 0o777).toBe(0o600)
			expect(fs.readFileSync(target, "utf-8")).toBe('{"token":"secret"}')
			expect(fs.readdirSync(tempDir)).toEqual(["secrets.json"])
		},
	)

	it("leaves no temporary file behind when the replace fails", () => {
		// A directory cannot be replaced by a file.
		const target = path.join(tempDir, "taken")
		fs.mkdirSync(path.join(target, "inside"), { recursive: true })

		expect(() => writePrivateFileSync(target, "data")).toThrow()
		expect(fs.readdirSync(tempDir)).toEqual(["taken"])
	})
})
