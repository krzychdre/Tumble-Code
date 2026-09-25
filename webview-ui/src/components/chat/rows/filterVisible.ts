import type { ClineAsk, ClineMessage, ClineSay } from "@roo-code/types"

/** The "ever visible" set: ts of rows the list has shown before. */
export interface EverVisibleSet {
	has(ts: number): boolean
	set(ts: number, value: true): unknown
}

/** Rows at the end of the list that count as shown (the viewport). */
export const EVER_VISIBLE_VIEWPORT = 100

// Kinds hidden even when shown before: they are only visible while they are
// the pending state of the task.
const ALWAYS_HIDDEN_ONCE_PROCESSED_ASK: ReadonlySet<ClineAsk> = new Set<ClineAsk>([
	"api_req_failed",
	"resume_task",
	"resume_completed_task",
])
const ALWAYS_HIDDEN_ONCE_PROCESSED_SAY: ReadonlySet<ClineSay> = new Set<ClineSay>([
	"api_req_finished",
	"api_req_retried",
	"api_req_deleted",
	"mcp_server_request_started",
])

const isEmptyText = (message: ClineMessage) => (message.text ?? "") === "" && (message.images?.length ?? 0) === 0

/**
 * The messages the chat list shows, in order. `messages` is the combined
 * history without the task message (`combineApiRequests(combineCommandSequences(...))`).
 *
 * A message whose ts is in `everVisible` stays visible unless its kind is
 * always hidden once processed; this keeps rows such as a retry notice on
 * screen after later messages arrive. The set is only read here; the caller
 * adds the shown rows with `markEverVisible` after the render.
 */
export function filterVisible(
	messages: readonly ClineMessage[],
	everVisible: Pick<EverVisibleSet, "has">,
): ClineMessage[] {
	// Checkpoint hashes that belong to user messages (legacy: those
	// checkpoint_saved rows are hidden).
	const userMessageCheckpointHashes = new Set<string>()
	for (const message of messages) {
		if (
			message.say === "user_feedback" &&
			message.checkpoint &&
			message.checkpoint["type"] === "user_message" &&
			message.checkpoint["hash"]
		) {
			userMessageCheckpointHashes.add(message.checkpoint["hash"] as string)
		}
	}

	const last1 = messages.at(-1)
	const last2 = messages.at(-2)

	return messages.filter((message) => {
		if (message.say === "checkpoint_saved") {
			if (
				message.checkpoint &&
				typeof message.checkpoint === "object" &&
				"suppressMessage" in message.checkpoint &&
				message.checkpoint.suppressMessage
			) {
				return false
			}
			if (message.text && userMessageCheckpointHashes.has(message.text)) {
				return false
			}
		}

		if (everVisible.has(message.ts)) {
			if (message.ask && ALWAYS_HIDDEN_ONCE_PROCESSED_ASK.has(message.ask)) return false
			if (message.say && ALWAYS_HIDDEN_ONCE_PROCESSED_SAY.has(message.say)) return false
			if (message.say === "text" && isEmptyText(message)) return false
			return true
		}

		switch (message.ask) {
			case "completion_result":
				if (message.text === "") return false
				break
			case "api_req_failed":
			case "resume_task":
			case "resume_completed_task":
				return false
		}
		switch (message.say) {
			case "api_req_finished":
			case "api_req_retried":
			case "api_req_deleted":
				return false
			case "api_req_retry_delayed":
			case "api_req_rate_limit_wait":
				// Shown only as the last message, or right before a trailing
				// resume_task ask.
				if (last1?.ask === "resume_task" && last2 === message) {
					return true
				} else if (message !== last1) {
					return false
				}
				break
			case "text":
				if (isEmptyText(message)) return false
				break
			case "mcp_server_request_started":
				return false
		}
		return true
	})
}

/** Add the rows in the last viewport of `visible` to the "ever visible" set. */
export function markEverVisible(visible: readonly ClineMessage[], everVisible: Pick<EverVisibleSet, "set">): void {
	for (const message of visible.slice(Math.max(0, visible.length - EVER_VISIBLE_VIEWPORT))) {
		everVisible.set(message.ts, true)
	}
}
