// cd src && npx vitest run utils/__tests__/privateTempFile.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { writePrivateTempFile } from "../privateTempFile"

const posix = process.platform !== "win32"

describe("writePrivateTempFile", () => {
	it("writes into a private directory, readable by the user only", async () => {
		const file = await writePrivateTempFile("roo-preview-1.md", "# conversation")

		expect(await fs.readFile(file, "utf8")).toBe("# conversation")
		expect(path.dirname(path.dirname(file))).toBe(path.resolve(os.tmpdir()))
		expect(path.basename(path.dirname(file))).toMatch(/^tumble-.{6}$/)
		if (posix) {
			expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
			expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
		}
	})

	it("never writes through a link at the name, and never overwrites", async () => {
		const first = await writePrivateTempFile("same.json", "one")
		const victim = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "victim-")), "victim.txt")
		await fs.writeFile(victim, "untouched")
		await fs.symlink(victim, path.join(path.dirname(first), "same-1.json"))

		const second = await writePrivateTempFile("same.json", "two")

		expect(await fs.readFile(first, "utf8")).toBe("one")
		expect(await fs.readFile(second, "utf8")).toBe("two")
		expect(path.basename(second)).toBe("same-2.json")
		expect(await fs.readFile(victim, "utf8")).toBe("untouched")
	})

	it("keeps only the file name of what it is given", async () => {
		const file = await writePrivateTempFile("../../escape.md", "x")
		expect(path.basename(file)).toBe("escape.md")
		expect(path.basename(path.dirname(file))).toMatch(/^tumble-/)
	})
})
