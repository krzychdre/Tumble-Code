import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		watch: false,
		testTimeout: 120_000, // 2m for integration tests.
		// Some suites build in beforeAll: cli-bundle.test.ts runs tsup twice
		// (about 1 s each on Linux, about 11 s each on the Windows CI runner,
		// which blew the 10 s default) and index.test.ts builds the CLI and the
		// extension. Give hooks the same generous limit as tests.
		hookTimeout: 120_000,
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
	},
})
