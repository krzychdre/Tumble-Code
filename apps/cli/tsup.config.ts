import { defineConfig } from "tsup"

import { BUNDLED_DEPENDENCIES } from "./src/lib/utils/release-manifest.js"

export default defineConfig({
	entry: ["src/index.ts", "src/lib/utils/release-manifest.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "node22",
	platform: "node",
	banner: {
		// The createRequire lines give the bundled CommonJS dependencies of @roo-code/core
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
	// such as "@roo-code/core/cli" and "react/jsx-runtime".
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
})
