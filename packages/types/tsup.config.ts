import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: {
		// tsup 8.5 always passes `baseUrl` to its declaration build, which
		// TypeScript 6 reports as deprecated (TS5101); see apps/cli/tsup.config.ts.
		compilerOptions: { ignoreDeprecations: "6.0" },
	},
	splitting: false,
	sourcemap: true,
	clean: true,
	outDir: "dist",
})
