/**
 * File-based debug logging utility
 *
 * This writes logs to ~/.roo/cli-debug.log, avoiding stdout/stderr
 * which would break TUI applications. The log format is timestamped JSON.
 *
 * Usage:
 *   import { debugLog, DebugLogger } from "@tumble-code/core/cli"
 *
 *   // Simple logging
 *   debugLog("handleModeSwitch", { mode: newMode, configId })
 *
 *   // Or create a named logger for a component
 *   const log = new DebugLogger("ClineProvider")
 *   log.info("handleModeSwitch", { mode: newMode })
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const DEBUG_LOG_PATH = path.join(os.homedir(), ".roo", "cli-debug.log")

let debugLogEnabled = false

/**
 * Where the debug log lives. The CLI names it in its crash report, so the
 * user knows which file to attach (or that --debug would have written it).
 */
export function getDebugLogPath(): string {
	return DEBUG_LOG_PATH
}

/**
 * Enable or disable file-based debug logging.
 * Logging is disabled by default and should only be enabled in dev/debug mode.
 */
export function setDebugLogEnabled(enabled: boolean): void {
	debugLogEnabled = enabled
	if (enabled) {
		prepareLogFile()
	}
}

/** Past this size the log is moved to `cli-debug.log.1` (replacing the previous one) when logging starts. */
const MAX_LOG_BYTES = 10 * 1024 * 1024

/**
 * The log holds prompts, paths and provider errors: only its owner may read
 * it, also when an older version created it readable by all.
 */
function prepareLogFile(): void {
	try {
		fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true, mode: 0o700 })
		fs.chmodSync(DEBUG_LOG_PATH, 0o600)
		if (fs.statSync(DEBUG_LOG_PATH).size > MAX_LOG_BYTES) {
			fs.renameSync(DEBUG_LOG_PATH, `${DEBUG_LOG_PATH}.1`)
		}
	} catch {
		// No log yet (the first entry creates it), or logging cannot work here.
	}
}

/**
 * Simple file-based debug log function.
 * Writes timestamped entries to ~/.roo/cli-debug.log
 * Only writes when enabled via setDebugLogEnabled(true).
 */
export function debugLog(message: string, data?: unknown): void {
	if (!debugLogEnabled) {
		return
	}
	try {
		const timestamp = new Date().toISOString()

		const entry = data
			? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}\n`
			: `[${timestamp}] ${message}\n`

		fs.appendFileSync(DEBUG_LOG_PATH, entry, { mode: 0o600 })
	} catch {
		// NO-OP - don't let logging errors break functionality
	}
}

/**
 * Debug logger with component context.
 * Prefixes all messages with the component name.
 */
export class DebugLogger {
	private component: string

	constructor(component: string) {
		this.component = component
	}

	/**
	 * Log a debug message with optional data
	 */
	debug(message: string, data?: unknown): void {
		debugLog(`[${this.component}] ${message}`, data)
	}

	/**
	 * Alias for debug
	 */
	info(message: string, data?: unknown): void {
		this.debug(message, data)
	}

	/**
	 * Log a warning
	 */
	warn(message: string, data?: unknown): void {
		debugLog(`[${this.component}] WARN: ${message}`, data)
	}

	/**
	 * Log an error
	 */
	error(message: string, data?: unknown): void {
		debugLog(`[${this.component}] ERROR: ${message}`, data)
	}
}

/**
 * Pre-configured logger for provider/mode debugging
 */
export const providerDebugLog = new DebugLogger("ProviderSettings")
