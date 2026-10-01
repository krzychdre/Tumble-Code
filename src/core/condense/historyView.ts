import Anthropic from "@anthropic-ai/sdk"

import { findLast } from "@roo-code/core/browser"

import { ApiMessage } from "../task-persistence/apiMessages"

/**
 * How many of the most-recent messages to keep RAW (verbatim) in the effective
 * history after a full condense, instead of collapsing to the summary alone.
 * ~3 native tool turns (assistant tool_use + user tool_result = 2 messages each),
 * i.e. the model's immediate working set. Keeping these intact lets work continue
 * seamlessly after a condense - the exact recent tool calls / results / decisions
 * survive, not just the lossy paraphrase.
 */
export const CONDENSE_KEEP_RECENT_MESSAGES = 6

/**
 * The recent raw tail is only kept when the since-last-summary region is at least
 * `CONDENSE_KEEP_RECENT_MESSAGES + CONDENSE_MIN_SUMMARIZED_MESSAGES` long, so that
 * summarizing the older prefix still yields a worthwhile reduction. On smaller
 * histories the classic fresh-start (summarize everything, no tail) is used.
 */
export const CONDENSE_MIN_SUMMARIZED_MESSAGES = 4

/**
 * Returns the list of all messages since the last summary message, including the summary.
 * Returns all messages if there is no summary.
 *
 * Note: Summary messages are always created with role: "user" (fresh-start model),
 * so the first message since the last summary is guaranteed to be a user message.
 */
export function getMessagesSinceLastSummary(messages: ApiMessage[]): ApiMessage[] {
	const lastSummaryIndexReverse = [...messages].reverse().findIndex((message) => message.isSummary)

	if (lastSummaryIndexReverse === -1) {
		return messages
	}

	const lastSummaryIndex = messages.length - lastSummaryIndexReverse - 1
	return messages.slice(lastSummaryIndex)
}

/**
 * True iff every `tool_result` block in `messages[boundary..]` has its matching
 * `tool_use` (same id) also within `messages[boundary..]`. Used to choose a
 * keep-boundary that does not split a tool pair (an orphaned tool_result in the
 * kept tail would be stripped by `getEffectiveApiHistory`).
 */
export function toolPairsSatisfiedFrom(messages: ApiMessage[], boundary: number): boolean {
	const toolUseIds = new Set<string>()
	for (let i = boundary; i < messages.length; i++) {
		const msg = messages[i]
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use") {
					toolUseIds.add((block as Anthropic.Messages.ToolUseBlockParam).id)
				}
			}
		}
	}
	for (let i = boundary; i < messages.length; i++) {
		const msg = messages[i]
		if (msg.role === "user" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (
					block.type === "tool_result" &&
					!toolUseIds.has((block as Anthropic.Messages.ToolResultBlockParam).tool_use_id)
				) {
					return false
				}
			}
		}
	}
	return true
}

/**
 * Computes the index into `messages` at which the recent RAW tail should start
 * when condensing (i.e. `messages[boundary..]` are kept verbatim and only
 * `messages[0..boundary)` are summarized/tagged). Returns `messages.length` to
 * signal "no tail - classic fresh start".
 *
 * Guarantees:
 * - Only keeps a tail when the since-last-summary region is large enough that
 *   summarizing the prefix is still worthwhile (the gate).
 * - The tail never reaches back to include a prior summary, so the new summary
 *   stays the last `isSummary` in the array (which `getEffectiveApiHistory` and
 *   `getMessagesSinceLastSummary` anchor on).
 * - The boundary NEVER splits a `tool_use`/`tool_result` pair. Two-direction
 *   search: first pull BACKWARD from `messages.length - keepRecent` (prefer
 *   keeping more raw messages), capped at `keepRecent*2` and floored so a
 *   pathological unpaired chain can't swallow the prefix. If the backward pull
 *   exhausts the cap without satisfying `toolPairsSatisfiedFrom`, fall FORWARD
 *   from the original position upward - the forward search always terminates
 *   because `boundary === messages.length` trivially satisfies (empty tail =
 *   classic fresh start, the safe degradation).
 *
 * Pure and deterministic; exported for direct unit testing.
 */
export function computeCondenseKeepBoundary(
	messages: ApiMessage[],
	keepRecent: number = CONDENSE_KEEP_RECENT_MESSAGES,
): number {
	const sinceLast = getMessagesSinceLastSummary(messages)

	// Gate: too small to benefit → no tail.
	if (keepRecent <= 0 || sinceLast.length < keepRecent + CONDENSE_MIN_SUMMARIZED_MESSAGES) {
		return messages.length
	}

	// Floor just past any prior summary at the start of the region, so the tail
	// can never contain an earlier summary.
	const sinceLastStart = messages.length - sinceLast.length
	const floor = sinceLast.length > 0 && sinceLast[0].isSummary ? sinceLastStart + 1 : sinceLastStart

	const initialBoundary = messages.length - keepRecent

	// Pull backward to avoid splitting a tool pair, bounded so it can't run away.
	const minBoundary = Math.max(floor, messages.length - keepRecent * 2)
	let boundary = initialBoundary
	while (boundary > minBoundary && !toolPairsSatisfiedFrom(messages, boundary)) {
		boundary--
	}

	// If the backward pull exhausted the cap without satisfying toolPairsSatisfiedFrom,
	// the current boundary still splits a pair. Fall FORWARD from the original position:
	// search upward for the first satisfying boundary. This always terminates because
	// boundary === messages.length trivially satisfies (empty tail = fresh start).
	if (!toolPairsSatisfiedFrom(messages, boundary)) {
		boundary = initialBoundary
		while (boundary < messages.length && !toolPairsSatisfiedFrom(messages, boundary)) {
			boundary++
		}
	}

	return Math.max(boundary, floor)
}

/**
 * Filters the API conversation history to get the "effective" messages to send to the API.
 *
 * Fresh Start Model:
 * - When a summary exists, return only messages from the summary onwards (fresh start)
 * - Messages with a condenseParent pointing to an existing summary are filtered out
 *
 * Messages with a truncationParent that points to an existing truncation marker are also filtered out,
 * as they have been hidden by sliding window truncation.
 *
 * This allows non-destructive condensing and truncation where messages are tagged but not deleted,
 * enabling accurate rewind operations while still sending condensed/truncated history to the API.
 *
 * @param messages - The full API conversation history including tagged messages
 * @returns The filtered history that should be sent to the API
 */
export function getEffectiveApiHistory(messages: ApiMessage[]): ApiMessage[] {
	// Find the most recent summary message
	const lastSummary = findLast(messages, (msg) => msg.isSummary === true)

	if (lastSummary) {
		// Fresh start model: return only messages from the summary onwards
		const summaryIndex = messages.indexOf(lastSummary)
		let messagesFromSummary = messages.slice(summaryIndex)

		// Collect all tool_use IDs from assistant messages in the result
		// This is needed to filter out orphan tool_result blocks that reference
		// tool_use IDs from messages that were condensed away
		const toolUseIds = new Set<string>()
		for (const msg of messagesFromSummary) {
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use" && (block as Anthropic.Messages.ToolUseBlockParam).id) {
						toolUseIds.add((block as Anthropic.Messages.ToolUseBlockParam).id)
					}
				}
			}
		}

		// Filter out orphan tool_result blocks from user messages
		messagesFromSummary = messagesFromSummary
			.map((msg) => {
				if (msg.role === "user" && Array.isArray(msg.content)) {
					const filteredContent = msg.content.filter((block) => {
						if (block.type === "tool_result") {
							return toolUseIds.has((block as Anthropic.Messages.ToolResultBlockParam).tool_use_id)
						}
						return true
					})
					// If all content was filtered out, mark for removal
					if (filteredContent.length === 0) {
						return null
					}
					// If some content was filtered, return updated message
					if (filteredContent.length !== msg.content.length) {
						return { ...msg, content: filteredContent }
					}
				}
				return msg
			})
			.filter((msg): msg is ApiMessage => msg !== null)

		// Still need to filter out any truncated messages within this range
		const existingTruncationIds = new Set<string>()
		for (const msg of messagesFromSummary) {
			if (msg.isTruncationMarker && msg.truncationId) {
				existingTruncationIds.add(msg.truncationId)
			}
		}

		return messagesFromSummary.filter((msg) => {
			// Filter out truncated messages if their truncation marker exists
			if (msg.truncationParent && existingTruncationIds.has(msg.truncationParent)) {
				return false
			}
			return true
		})
	}

	// No summary - filter based on condenseParent and truncationParent as before
	// This handles the case of orphaned condenseParent tags (summary was deleted via rewind)

	// Collect all condenseIds of summaries that exist in the current history
	const existingSummaryIds = new Set<string>()
	// Collect all truncationIds of truncation markers that exist in the current history
	const existingTruncationIds = new Set<string>()

	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId) {
			existingSummaryIds.add(msg.condenseId)
		}
		if (msg.isTruncationMarker && msg.truncationId) {
			existingTruncationIds.add(msg.truncationId)
		}
	}

	// Filter out messages whose condenseParent points to an existing summary
	// or whose truncationParent points to an existing truncation marker.
	// Messages with orphaned parents (summary/marker was deleted) are included.
	return messages.filter((msg) => {
		// Filter out condensed messages if their summary exists
		if (msg.condenseParent && existingSummaryIds.has(msg.condenseParent)) {
			return false
		}
		// Filter out truncated messages if their truncation marker exists
		if (msg.truncationParent && existingTruncationIds.has(msg.truncationParent)) {
			return false
		}
		return true
	})
}

/**
 * Cleans up orphaned condenseParent and truncationParent references after a truncation operation (rewind/delete).
 * When a summary message or truncation marker is deleted, messages that were tagged with its ID
 * should have their parent reference cleared so they become active again.
 *
 * This function should be called after any operation that truncates the API history
 * to ensure messages are properly restored when their summary or truncation marker is deleted.
 *
 * @param messages - The API conversation history after truncation
 * @returns The cleaned history with orphaned condenseParent and truncationParent fields cleared
 */
export function cleanupAfterTruncation(messages: ApiMessage[]): ApiMessage[] {
	// Collect all condenseIds of summaries that still exist
	const existingSummaryIds = new Set<string>()
	// Collect all truncationIds of truncation markers that still exist
	const existingTruncationIds = new Set<string>()

	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId) {
			existingSummaryIds.add(msg.condenseId)
		}
		if (msg.isTruncationMarker && msg.truncationId) {
			existingTruncationIds.add(msg.truncationId)
		}
	}

	// Clear orphaned parent references for messages whose summary or truncation marker was deleted
	return messages.map((msg) => {
		let needsUpdate = false

		// Check for orphaned condenseParent
		if (msg.condenseParent && !existingSummaryIds.has(msg.condenseParent)) {
			needsUpdate = true
		}

		// Check for orphaned truncationParent
		if (msg.truncationParent && !existingTruncationIds.has(msg.truncationParent)) {
			needsUpdate = true
		}

		if (needsUpdate) {
			// Create a new object without orphaned parent references
			const { condenseParent, truncationParent, ...rest } = msg
			const result: ApiMessage = rest as ApiMessage

			// Keep condenseParent if its summary still exists
			if (condenseParent && existingSummaryIds.has(condenseParent)) {
				result.condenseParent = condenseParent
			}

			// Keep truncationParent if its truncation marker still exists
			if (truncationParent && existingTruncationIds.has(truncationParent)) {
				result.truncationParent = truncationParent
			}

			return result
		}
		return msg
	})
}
