import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
	},
	resolve: {
		alias: {
			// The esbuild configs of src/ and apps/vscode-nightly/ import this package;
			// resolve it to the sources so the tests do not need a prior `tsc` build.
			"@roo-code/build": path.resolve(__dirname, "src/index.ts"),
		},
	},
})
