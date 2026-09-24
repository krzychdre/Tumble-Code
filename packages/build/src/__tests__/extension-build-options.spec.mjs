// DEF-C30: the nightly VSIX (apps/vscode-nightly/esbuild.mjs) must bundle the
// extension with the same externals and aliases as the release VSIX
// (src/esbuild.mjs). A hand copy of the release config drifted: it bundled
// global-agent (which breaks when bundled) and let `require("punycode")` load
// Node's deprecated built-in instead of Punycode.js.

import path from "node:path"
import { describe, expect, it } from "vitest"

// This spec compares the build configs of two other workspaces on purpose
// (DEF-C30), so it reaches them by path. PKG-2 boundary rule exemption.
// eslint-disable-next-line boundaries/no-relative-import-outside-package
import { createBuildOptions as createReleaseBuildOptions } from "../../../../src/esbuild.mjs"
// eslint-disable-next-line boundaries/no-relative-import-outside-package
import { createBuildOptions as createNightlyBuildOptions } from "../../../../apps/vscode-nightly/esbuild.mjs"

const srcDir = path.resolve(import.meta.dirname, "../../../../src")
const nightlyArgs = { version: "0.0.1", gitSha: "abc1234" }

describe.each([false, true])("extension build options (production: %s)", (production) => {
	const release = createReleaseBuildOptions({ production }).extension
	const nightly = createNightlyBuildOptions({ production, ...nightlyArgs }).extension

	it("release keeps the modules that must not be bundled external", () => {
		expect(release.external).toEqual(
			expect.arrayContaining(["vscode", "esbuild", "global-agent", "@vscode/ripgrep"]),
		)
	})

	it("nightly externalizes every module the release externalizes", () => {
		expect(nightly.external).toEqual(expect.arrayContaining(release.external))
	})

	it("nightly uses the release aliases (Punycode.js instead of Node's built-in punycode)", () => {
		expect(release.alias).toMatchObject({ punycode: "punycode/" })
		expect(nightly.alias).toEqual(release.alias)
	})

	it("both resolve alias targets from the extension package, which depends on punycode", () => {
		expect(release.absWorkingDir).toBe(srcDir)
		expect(nightly.absWorkingDir).toBe(srcDir)
	})

	it("both bundle the same way apart from nightly-only defines and output paths", () => {
		for (const key of ["bundle", "minify", "format", "platform", "sourcesContent", "logLevel"]) {
			expect(nightly[key], key).toEqual(release[key])
		}
	})
})
