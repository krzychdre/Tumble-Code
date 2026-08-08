import fs from "fs"
import os from "os"
import path from "path"

import { Uri } from "../classes/Uri.js"
import { createVSCodeAPIMock } from "../api/create-vscode-api-mock.js"

describe("createVSCodeAPIMock openExternal", () => {
	it("delegates URLs to the host-provided opener", async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-shim-open-external-"))
		const opener = vi.fn(async () => false)
		try {
			const vscode = createVSCodeAPIMock(process.cwd(), process.cwd(), undefined, {
				storageDir,
				openExternal: opener,
			})
			await expect(vscode.env.openExternal(Uri.parse("https://auth.openai.test/path?q=1"))).resolves.toBe(false)
			expect(opener).toHaveBeenCalledWith("https://auth.openai.test/path?q=1")
		} finally {
			fs.rmSync(storageDir, { recursive: true, force: true })
		}
	})
})
