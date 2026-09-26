import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
		// Vitest 4 stopped excluding dist/ by default; keep build output (tsc emits
		// compiled copies of the specs there) out of the run.
		exclude: [...configDefaults.exclude, "**/dist/**"],
		// The handoff and installer tests make real durable writes (fsync,
		// atomic rename), and on the Windows CI runner, while every other
		// workspace's suite runs in parallel, their duration swings about 20x
		// between runs: "records the pick-up" took 142 ms in one run and
		// 2,846 ms in another, and single tests reached 5.1 s and failed
		// vitest's default 5 s timeout. Nothing hangs, the disk is just slow
		// and uneven there; the durability they check is the point, so they
		// keep syncing and get a budget that fits the platform.
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
})
