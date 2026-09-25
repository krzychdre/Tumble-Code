export function resolveVerbosity(argv = process.argv, env = process.env) {
	// Check if --no-silent flag is used (native vitest flag)
	const cliNoSilent = argv.includes("--no-silent") || argv.includes("--silent=false")
	const silent = !cliNoSilent // Silent by default

	// Check if verbose reporter is requested
	const wantsVerboseReporter = argv.some(
		(a) => a === "--reporter=verbose" || a === "-r=verbose" || a === "--reporter",
	)

	// Vitest adds its GitHub Actions reporter only when no reporters are
	// configured, and listing "dot" here switched it off. Without it a failing
	// test on CI surfaced only as "tumble-code#test exited (1)", with the test
	// names buried in a log that needs authentication to download.
	const onGitHubActions = env.GITHUB_ACTIONS === "true"

	return {
		silent,
		reporters: [
			"dot",
			...(wantsVerboseReporter ? ["verbose"] : []),
			...(onGitHubActions ? ["github-actions"] : []),
			...(onGitHubActions ? [["json", { outputFile: "vitest-report.json" }] as any] : []),
		],
		onConsoleLog: (_log: string, type: string) => {
			// When verbose, show everything
			// When silent, allow errors/warnings and drop info/log/warn noise
			if (!silent || type === "stderr") return

			return false // Drop info/log/warn noise
		},
	}
}
