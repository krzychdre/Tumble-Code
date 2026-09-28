// Shared vitest settings for every workspace (D15). A workspace's vitest.config.ts
// calls defineRooVitestConfig() with only what differs: its aliases, setup files,
// environment, include globs and timeouts.
//
// Plain JavaScript on purpose: vitest bundles each vitest.config.ts but loads
// imported workspace packages with Node itself, so this file must run without a
// TypeScript step. index.d.ts carries the types.

import { configDefaults, defineConfig, mergeConfig } from "vitest/config"

/**
 * The settings every workspace had copied into its own config.
 *
 * - globals: the specs call describe/it/expect/vi without importing them.
 * - environment "node": vitest's default too; webview-ui overrides it with jsdom.
 * - watch false: `vitest` without `run` must not hang CI or turbo.
 * - exclude dist: vitest 4 stopped excluding dist/ by default; tsc emits
 *   compiled copies of the specs there, and they must not run a second time.
 */
export const sharedTestConfig = {
	globals: true,
	environment: "node",
	watch: false,
	exclude: [...configDefaults.exclude, "**/dist/**"],
}

/**
 * Build a workspace's vitest config from the shared settings plus `overrides`.
 * Objects merge deeply and arrays concatenate (vite's mergeConfig), so an
 * `exclude` in the overrides adds to the shared one instead of replacing it.
 */
export function defineRooVitestConfig(overrides = {}) {
	return mergeConfig(defineConfig({ test: sharedTestConfig }), overrides)
}

/**
 * Quiet-by-default console and reporter settings (used by src and webview-ui,
 * spread into `test`).
 *
 * - `--no-silent` (or `--silent=false`) on the command line shows console output.
 * - `--reporter=verbose` adds the verbose reporter next to "dot".
 * - On GitHub Actions the github-actions reporter is added explicitly: vitest
 *   adds it only when no reporters are configured, and listing "dot" here
 *   switched it off, so a failing test on CI surfaced only as
 *   "tumble-code#test exited (1)" with the test names buried in a log that
 *   needs authentication to download.
 */
export function resolveVerbosity(argv = process.argv, env = process.env) {
	const cliNoSilent = argv.includes("--no-silent") || argv.includes("--silent=false")
	const silent = !cliNoSilent

	const wantsVerboseReporter = argv.some(
		(a) => a === "--reporter=verbose" || a === "-r=verbose" || a === "--reporter",
	)

	const onGitHubActions = env.GITHUB_ACTIONS === "true"

	return {
		silent,
		reporters: [
			"dot",
			...(wantsVerboseReporter ? ["verbose"] : []),
			...(onGitHubActions ? ["github-actions"] : []),
		],
		onConsoleLog: (_log, type) => {
			// Verbose: show everything. Silent: keep stderr (errors and warnings
			// written there), drop the info/log noise.
			if (!silent || type === "stderr") return

			return false
		},
	}
}
