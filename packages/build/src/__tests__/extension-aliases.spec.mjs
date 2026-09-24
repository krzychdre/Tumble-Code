import * as esbuild from "esbuild"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { extensionAliases } from "@roo-code/build"

// The extension package, which depends on punycode.
const srcDir = path.resolve(import.meta.dirname, "../../../../src")

describe("extension esbuild aliases", () => {
	it("bundles userland Punycode.js instead of Node's deprecated built-in", async () => {
		const result = await esbuild.build({
			stdin: {
				contents: 'module.exports = require("punycode")',
				resolveDir: srcDir,
			},
			// esbuild resolves alias targets from the working directory.
			absWorkingDir: srcDir,
			alias: extensionAliases,
			bundle: true,
			format: "cjs",
			platform: "node",
			write: false,
		})
		const bundle = result.outputFiles[0].text

		expect(bundle).toContain("node_modules/punycode/punycode.js")
		expect(bundle).not.toMatch(/require\(["'](?:node:)?punycode["']\)/)
	})
})
