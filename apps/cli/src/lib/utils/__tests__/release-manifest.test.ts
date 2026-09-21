import { createReleaseManifest } from "../release-manifest.js"

describe("createReleaseManifest", () => {
	it("preserves external runtime dependencies and excludes bundled workspace packages", () => {
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
					execa: "^9.5.2",
					"json-stream-stringify": "^3.1.6",
					"proper-lockfile": "^4.1.2",
					react: "^19.1.0",
				},
			},
			"0.1.17-local.test",
		)

		expect(manifest).toEqual({
			name: "@tumble-code/cli",
			version: "0.1.17-local.test",
			type: "module",
			dependencies: {
				execa: "^9.5.2",
				"json-stream-stringify": "^3.1.6",
				"proper-lockfile": "^4.1.2",
				react: "^19.1.0",
			},
		})
	})
})
