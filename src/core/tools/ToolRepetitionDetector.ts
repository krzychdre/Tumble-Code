import stringify from "safe-stable-stringify"
import { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

/**
 * Class for detecting consecutive identical tool calls
 * to prevent the AI from getting stuck in a loop.
 */
export class ToolRepetitionDetector {
	private previousToolCallJson: string | null = null
	private consecutiveIdenticalToolCallCount: number = 0
	private readonly consecutiveIdenticalToolCallLimit: number
	// The call stopped by the last trip, kept until a different call comes:
	// a second trip on it means the hint after the first one did not help.
	private lastTrippedToolCallJson: string | null = null

	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed
	 */
	constructor(limit: number = 3) {
		this.consecutiveIdenticalToolCallLimit = limit
	}

	/**
	 * Checks if the current tool call is identical to the previous one
	 * and determines if execution should be allowed
	 *
	 * @param currentToolCallBlock ToolUse object representing the current tool call
	 * @returns Object indicating if execution is allowed and a message to show if not
	 */
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean
		askUser?: {
			messageKey: string
			messageDetail: string
		}
		/** The same call was already stopped once, with no other call since. */
		repeatedTrip?: boolean
	} {
		// wait_for_subagents takes no arguments, so every call looks the same,
		// yet each returns a different result (the next subagent that
		// finished). Calling it again and again is its normal use. A model
		// that calls it with nothing to wait for counts a mistake in the tool.
		if (currentToolCallBlock.name === "wait_for_subagents") {
			this.previousToolCallJson = null
			this.consecutiveIdenticalToolCallCount = 0
			return { allowExecution: true }
		}

		// Serialize the block to a canonical JSON string for comparison
		const currentToolCallJson = this.serializeToolUse(currentToolCallBlock)
		if (this.lastTrippedToolCallJson !== null && this.lastTrippedToolCallJson !== currentToolCallJson) {
			this.lastTrippedToolCallJson = null
		}

		// Compare with previous tool call
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++
		} else {
			this.consecutiveIdenticalToolCallCount = 0 // Reset to 0 for a new tool
			this.previousToolCallJson = currentToolCallJson
		}

		// Check if limit is reached (0 means unlimited)
		if (
			this.consecutiveIdenticalToolCallLimit > 0 &&
			this.consecutiveIdenticalToolCallCount >= this.consecutiveIdenticalToolCallLimit
		) {
			// Reset counters to allow recovery if user guides the AI past this point
			this.consecutiveIdenticalToolCallCount = 0
			this.previousToolCallJson = null
			const repeatedTrip = this.lastTrippedToolCallJson === currentToolCallJson
			this.lastTrippedToolCallJson = currentToolCallJson

			// Return result indicating execution should not be allowed
			return {
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: t("tools:toolRepetitionLimitReached", { toolName: currentToolCallBlock.name }),
				},
				repeatedTrip,
			}
		}

		// Execution is allowed
		return { allowExecution: true }
	}

	/**
	 * Serializes a ToolUse object into a canonical JSON string for comparison
	 *
	 * @param toolUse The ToolUse object to serialize
	 * @returns JSON string representation of the tool use with sorted parameter keys
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		const toolObject: Record<string, any> = {
			name: toolUse.name,
			params: toolUse.params,
		}

		// Only include nativeArgs if it has content
		if (toolUse.nativeArgs && Object.keys(toolUse.nativeArgs).length > 0) {
			toolObject.nativeArgs = toolUse.nativeArgs
		}

		return stringify(toolObject)
	}
}
