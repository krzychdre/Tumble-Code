import fs from "fs"
import os from "os"
import path from "path"

import { createEphemeralStorageDir } from "../ephemeral.js"

describe("createEphemeralStorageDir", () => {
	it("makes a new private directory in the temp directory each time", async () => {
		const first = await createEphemeralStorageDir()
		const second = await createEphemeralStorageDir()
		try {
			expect(first).not.toBe(second)
			expect(path.dirname(first)).toBe(path.resolve(os.tmpdir()))
			expect(path.basename(first)).toMatch(/^roo-cli-.{6}$/)
			if (process.platform !== "win32") {
				expect(fs.statSync(first).mode & 0o777).toBe(0o700)
			}
		} finally {
			fs.rmSync(first, { recursive: true, force: true })
			fs.rmSync(second, { recursive: true, force: true })
		}
	})
})
