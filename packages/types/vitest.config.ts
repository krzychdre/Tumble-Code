import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		watch: false,
		// Vitest 4 stopped excluding dist/ by default; keep build output (tsc emits
		// compiled copies of the specs there) out of the run.
		exclude: [...configDefaults.exclude, "**/dist/**"],
	},
})
