import path from "path"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
		// Vitest 4 stopped excluding dist/ by default; keep build output (tsc emits
		// compiled copies of the specs there) out of the run.
		exclude: [...configDefaults.exclude, "**/dist/**"],
	},
	resolve: {
		alias: {
			// The esbuild configs of src/ and apps/vscode-nightly/ import this package;
			// resolve it to the sources so the tests do not need a prior `tsc` build.
			"@roo-code/build": path.resolve(__dirname, "src/index.ts"),
		},
	},
})
