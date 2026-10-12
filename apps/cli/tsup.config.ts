import { defineConfig } from "tsup"

import { BUNDLED_DEPENDENCIES } from "./src/lib/utils/release-manifest.js"

export default defineConfig([
	{
		entry: ["src/index.ts", "src/lib/utils/release-manifest.ts"],
		format: ["esm"],
		dts: {
			// tsup 8.5 always passes `baseUrl` to its declaration build (dist/rollup.js
			// sets `baseUrl: compilerOptions.baseUrl || "."`), and TypeScript 6 reports
			// that option as deprecated (TS5101). The silencer applies to this
			// declaration build only; our own tsconfig has no baseUrl and
			// `tsc --noEmit` still reports every deprecation. TypeScript 7 drops the
			// option, so tsup (or its replacement) must stop passing it before then.
			compilerOptions: { ignoreDeprecations: "6.0" },
		},
		// Everything but the MathJax engine, which the config below writes in parallel.
		clean: ["!mathjax-engine.cjs"],
		sourcemap: true,
		target: "node22",
		platform: "node",
		banner: {
			// The createRequire lines give the bundled CommonJS dependencies of @tumble-code/core
			// (proper-lockfile and its graceful-fs) a real `require` for Node built-ins; without
			// it esbuild's ESM output throws "Dynamic require of \"fs\" is not supported".
			js: [
				"#!/usr/bin/env node",
				"import { createRequire as __cliCreateRequire } from 'node:module'",
				"const require = __cliCreateRequire(import.meta.url)",
			].join("\n"),
		},
		// Bundle the workspace packages (they export TypeScript) and the packages the
		// terminal UI renders with, together with everything they import, at the
		// lockfile versions; see BUNDLED_DEPENDENCIES. A prefix also covers subpaths
		// such as "@tumble-code/core/cli" and "react/jsx-runtime".
		noExternal: BUNDLED_DEPENDENCIES,
		external: [
			// Keep native modules external
			"@anthropic-ai/sdk",
			"@anthropic-ai/bedrock-sdk",
			"@anthropic-ai/vertex-sdk",
			// Keep @vscode/ripgrep external - we bundle the binary separately
			"@vscode/ripgrep",
			// Optional dependency of ink, imported only when DEV=true; not shipped.
			"react-devtools-core",
		],
		esbuildOptions(options) {
			// Enable JSX for React/Ink components
			options.jsx = "automatic"
			options.jsxImportSource = "react"
		},
	},
	{
		// MathJax with the glyph ranges it needs, in one file that
		// src/ui/graphics/math.ts loads with require() on the first formula:
		// CommonJS, because Node 22 before 22.12 cannot require() an ES module.
		// Bundling it ships about 4 MB instead of the 105 MB of the packages.
		entry: { "mathjax-engine": "src/ui/graphics/mathjax-engine.ts" },
		format: ["cjs"],
		outExtension: () => ({ js: ".cjs" }),
		clean: false,
		// Third-party code: a source map would double the file and help no one.
		sourcemap: false,
		target: "node22",
		platform: "node",
		noExternal: [/^@mathjax\//],
	},
])
