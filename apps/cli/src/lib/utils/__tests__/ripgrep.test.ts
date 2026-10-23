import fs from "fs"
import path from "path"

import { resolveRipgrepPath } from "../ripgrep.js"

const binName = process.platform === "win32" ? "rg.exe" : "rg"

afterEach(() => {
	vi.unstubAllEnvs()
})

describe("resolveRipgrepPath", () => {
	it("prefers an absolute ROO_RIPGREP_PATH", async () => {
		const override = path.resolve("/opt/tumble/bin", binName)
		vi.stubEnv("ROO_RIPGREP_PATH", override)

		expect(await resolveRipgrepPath()).toBe(override)
	})

	it.each([
		["unset", ""],
		["relative", path.join("bin", binName)],
	])("falls back to the @vscode/ripgrep platform package when the override is %s", async (_name, override) => {
		vi.stubEnv("ROO_RIPGREP_PATH", override)

		const binary = await resolveRipgrepPath()

		expect(binary).toContain(path.join(`@vscode/ripgrep-${process.platform}-${process.arch}`, "bin", binName))
		expect(fs.existsSync(binary!)).toBe(true)
	})
})
