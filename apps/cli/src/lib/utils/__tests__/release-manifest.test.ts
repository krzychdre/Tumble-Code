import fs from "fs"
import path from "path"

import { createReleaseManifest, readInstalledVersion } from "../release-manifest.js"

import { CLI_ROOT, lockedVersions } from "./lockfile.js"

// The packages the terminal UI renders with. The release runs `npm install`
// without a lockfile, so any of them left in the manifest floats to whatever
// the registry has that day (the installed CLI once had React 19.3.0 while
// development used 19.2.3).
const RENDER_CRITICAL = ["ink", "react", "react-reconciler", "scheduler", "yoga-layout", "zustand"]

describe("createReleaseManifest", () => {
	it("drops the bundled packages and pins the remaining ones to their installed version", () => {
		const installed: Record<string, string> = { execa: "9.6.0", commander: "12.1.0" }

		const manifest = createReleaseManifest(
			{
				name: "@tumble-code/cli",
				version: "0.1.17",
				type: "module",
				dependencies: {
					"@roo-code/core": "workspace:^",
					"@roo-code/types": "workspace:^",
					"@roo-code/vscode-shim": "workspace:^",
					"@vscode/ripgrep": "^1.15.9",
					commander: "^12.1.0",
					execa: "^9.5.2",
					ink: "6.6.0",
					react: "^19.1.0",
					zustand: "^5.0.0",
				},
			},
			"0.1.17-local.test",
			(name) => installed[name]!,
		)

		expect(manifest).toEqual({
			name: "@tumble-code/cli",
			version: "0.1.17-local.test",
			type: "module",
			dependencies: {
				commander: "12.1.0",
				execa: "9.6.0",
			},
		})
	})

	it("builds the real manifest with no render-critical package and every other one at its lockfile version", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf8"))
		const locked = lockedVersions()

		const { dependencies = {} } = createReleaseManifest(pkg, "0.0.0-test", readInstalledVersion(CLI_ROOT))

		for (const name of RENDER_CRITICAL) {
			expect(dependencies).not.toHaveProperty(name)
		}

		expect(Object.keys(dependencies).length).toBeGreaterThan(0)

		for (const [name, version] of Object.entries(dependencies)) {
			expect({ name, version }).toEqual({ name, version: locked[name] })
		}
	})
})
