import { configDefaults, defineConfig } from "vitest/config"
import path from "path"
import { resolveVerbosity } from "./utils/vitest-verbosity"

const { silent, reporters, onConsoleLog } = resolveVerbosity()
const isWindowsCI = process.platform === "win32" && process.env.CI === "true"

export default defineConfig({
	test: {
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		watch: false,
		// Vitest 4 stopped excluding dist/ by default; keep build output (tsc emits
		// compiled copies of the specs there) out of the run.
		exclude: [...configDefaults.exclude, "**/dist/**"],
		reporters,
		silent,
		testTimeout: 20_000,
		hookTimeout: 20_000,
		onConsoleLog,
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
