import { defineConfig } from "tsup"

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
	// Bundle workspace packages that export TypeScript
	noExternal: ["@roo-code/core", "@roo-code/core/cli", "@roo-code/types", "@roo-code/vscode-shim"],
	external: [
		// Keep native modules external
		"@anthropic-ai/sdk",
		"@anthropic-ai/bedrock-sdk",
		"@anthropic-ai/vertex-sdk",
		// Keep @vscode/ripgrep external - we bundle the binary separately
		"@vscode/ripgrep",
		// Optional dev dependency of ink - not needed at runtime
		"react-devtools-core",
	],
	esbuildOptions(options) {
		// Enable JSX for React/Ink components
		options.jsx = "automatic"
		options.jsxImportSource = "react"
	},
})
