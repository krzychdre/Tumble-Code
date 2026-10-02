/**
 * The crash report (UI plan §4): the error itself, then where the debug log
 * is and, for a run without --debug, how to get one.
 *
 * Callers write it with `process.stderr.write`, never `console.error`: while
 * the extension host is alive (its quiet mode, extension-host.ts
 * setupQuietMode) console.error is routed into the debug log, which a run
 * without --debug does not even write.
 */

export interface CrashHintOptions {
	/** Whether this run was started with --debug (the log is being written). */
	debug: boolean
	/** The debug log file (`getDebugLogPath()` from @tumble-code/core/cli). */
	logPath: string
}

export interface CrashReportOptions extends CrashHintOptions {
	/** What caught the error: a guard name ("uncaughtException") or a phase. */
	source?: string
}

export function formatCrashHint({ debug, logPath }: CrashHintOptions): string {
	return debug
		? `The debug log has the details: ${logPath}`
		: `For details, run again with --debug; it writes a debug log to ${logPath}`
}

export function formatCrashReport(error: unknown, { source, ...hint }: CrashReportOptions): string {
	const detail = error instanceof Error ? error.stack || `${error.name}: ${error.message}` : String(error)
	const heading = source ? `[CLI] Crashed (${source}):` : "[CLI] Crashed:"

	return `${heading} ${detail}\n${formatCrashHint(hint)}\n`
}
