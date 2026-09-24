/**
 * @fileoverview Main entry point for the compact logging system
 * Provides a default logger instance with Jest environment detection
 */

import { CompactLogger } from "./CompactLogger"

/**
 * No-operation logger implementation for production environments
 */
const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	child: () => noopLogger,
	close: () => {},
}

/**
 * Default logger instance.
 *
 * Outside tests this is the no-op logger: nothing wires it to an output
 * channel yet. Under test the real CompactLogger is opt-in (ROO_TEST_LOGS=1):
 * it writes straight to stdout, past vitest's silent mode, and printed
 * hundreds of JSON lines per run that buried the failure summary. Tests that
 * assert on logging spy on or mock these methods instead.
 */
export const logger =
	process.env.NODE_ENV === "test" && process.env.ROO_TEST_LOGS === "1" ? new CompactLogger() : noopLogger
