import { logger } from "../../utils/logging"

/**
 * Error thrown when an ask promise is superseded by a newer one.
 *
 * This is used as an internal control flow signal - not an actual error.
 * It occurs when multiple asks are sent in rapid succession and an older
 * ask is invalidated by a newer one (e.g., during streaming updates).
 */
export class AskIgnoredError extends Error {
	constructor(reason?: string) {
		super(reason ? `Ask ignored: ${reason}` : "Ask ignored")
		this.name = "AskIgnoredError"
		// Maintains proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, AskIgnoredError.prototype)
	}
}

/**
 * `.catch` handler for the asks a tool posts only to show its row: partial
 * updates while the model is still writing the call, or the finalize of such
 * a row. They reject with AskIgnoredError as soon as the next update or the
 * real ask supersedes them, which is the normal path and not worth a line.
 * Anything else (typically "task aborted", which the tool loop handles on its
 * own) is logged at debug.
 */
export function ignorePartialAskRejection(error: unknown): void {
	if (error instanceof AskIgnoredError) {
		return
	}
	logger.debug(`[ask] partial update rejected: ${error instanceof Error ? error.message : String(error)}`)
}
