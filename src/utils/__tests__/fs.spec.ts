import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import * as path from "path"

import { loadOptionalEnvFile } from "../fs"

describe("loadOptionalEnvFile", () => {
	let dir: string

	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "env-file-"))
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
		delete process.env.TUMBLE_ENV_PROBE_NEW
		delete process.env.TUMBLE_ENV_PROBE_SET
	})

	it("ignores a missing file", () => {
		expect(() => loadOptionalEnvFile(path.join(dir, ".env"))).not.toThrow()
	})

	it("loads the file without overriding variables already set", () => {
		const envPath = path.join(dir, ".env")
		writeFileSync(envPath, '# comment\nTUMBLE_ENV_PROBE_NEW="from file"\nTUMBLE_ENV_PROBE_SET=from-file\n')
		process.env.TUMBLE_ENV_PROBE_SET = "from-environment"

		loadOptionalEnvFile(envPath)

		expect(process.env.TUMBLE_ENV_PROBE_NEW).toBe("from file")
		expect(process.env.TUMBLE_ENV_PROBE_SET).toBe("from-environment")
	})
})
