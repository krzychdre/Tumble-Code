/**
 * @fileoverview Main entry point for the compact logging system
 * Provides the shared `logger` and the hook that points it at a destination
 */

import { CompactLogger } from "./CompactLogger"
import { OutputChannelTransport } from "./OutputChannelTransport"
import type { ILogger, LogMeta } from "./types"

/**
 * No-operation logger: the destination until one is configured
 */
const noopLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	child: () => noopLogger,
	close: () => {},
}

// Under test the real CompactLogger is opt-in (ROO_TEST_LOGS=1): it writes
// straight to stdout, past vitest's silent mode, and printed hundreds of JSON
// lines per run that buried the failure summary. Tests that assert on logging
// spy on or mock the `logger` methods instead.
let destination: ILogger =
	process.env.NODE_ENV === "test" && process.env.ROO_TEST_LOGS === "1" ? new CompactLogger() : noopLogger

/**
 * Sends every later `logger` call, including calls from modules that imported
 * `logger` before this ran, to `next`.
 */
export function configureLogger(next: ILogger): void {
	destination = next
}

/**
 * A logger that writes readable lines through `appendLine` (an output
 * channel's) at `info` and above.
 */
export function createLineLogger(appendLine: (line: string) => void): ILogger {
	return new CompactLogger(new OutputChannelTransport(appendLine, "info"))
}

/** Merges child metadata over its parent's, keeping the parent's context unless the child sets one. */
function mergeMeta(parent: LogMeta | undefined, meta: LogMeta | undefined): LogMeta | undefined {
	if (!parent) return meta
	if (!meta) return parent
	return { ...parent, ...meta, ctx: meta.ctx ?? parent.ctx }
}

/**
 * Resolves the destination on every call rather than at import time: modules
 * import `logger` long before the extension activates and configures it.
 */
function forwardingLogger(meta?: LogMeta): ILogger {
	return {
		debug: (message, m) => destination.debug(message, mergeMeta(meta, m)),
		info: (message, m) => destination.info(message, mergeMeta(meta, m)),
		warn: (message, m) => destination.warn(message, mergeMeta(meta, m)),
		error: (message, m) => destination.error(message, mergeMeta(meta, m)),
		fatal: (message, m) => destination.fatal(message, mergeMeta(meta, m)),
		child: (m) => forwardingLogger(mergeMeta(meta, m)),
		close: () => destination.close(),
	}
}

/**
 * Shared logger. A no-op until the extension calls `configureLogger` on
 * activation, which points it at the Tumble Code output channel.
 */
export const logger: ILogger = forwardingLogger()
