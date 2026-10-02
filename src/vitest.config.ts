import path from "path"
import { defineRooVitestConfig, resolveVerbosity } from "@tumble-code/config-vitest"

const isWindowsCI = process.platform === "win32" && process.env.CI === "true"

export default defineRooVitestConfig({
	test: {
		...resolveVerbosity(),
		setupFiles: ["./vitest.setup.ts"],
		testTimeout: 20_000,
		hookTimeout: 20_000,
		// Windows CI: run test files sequentially (one fork at a time) but KEEP
		// vitest's default per-file process isolation. The previous singleFork
		// mode ran all ~500 files in ONE child process with no isolation; state
		// leaked across files (deleted globals like fetch, stray timers,
		// unbounded heap growth from undisposed providers/watchers) until the
		// event loop starved and whole describe blocks timed out at 20s
		// (Task.spec.ts was the usual victim). Sequential-but-isolated keeps
		// the original cross-worker-flake fix without the accumulation.
		// Vitest 4 removed `poolOptions` (forks.maxForks/minForks): the worker
		// cap is the top-level `maxWorkers`, and `isolate` stays at its default
		// (true), so every file still gets a fresh process.
		maxWorkers: isWindowsCI ? 1 : undefined,
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "./__mocks__/vscode.js"),
		},
	},
})
