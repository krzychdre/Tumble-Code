/**
 * Invocation identity for `ask: "tool"` approval messages.
 *
 * Every askApproval-using tool streams in two phases:
 *  - `handlePartial` emits a placeholder card while the tool call streams.
 *  - `requestApproval` / `execute` emits the COMPLETE card.
 *
 * A streaming race can finalize the placeholder (`partial: true -> false`)
 * before the complete `ask(..., false)` runs. The finalized-duplicate dedup in
 * TaskAskSay must then reuse that placeholder instead of appending a second
 * card. A raw text comparison fails for tools whose placeholder and complete
 * payloads differ (read_file adds reason/content/startLine; search_files swaps
 * content:"" for results; etc.).
 *
 * The discriminator must be invocation-precise: it must reuse the placeholder
 * of THE SAME tool invocation, but it must NEVER merge two DIFFERENT
 * invocations - even when their tool, path and range are identical - or a
 * second legitimate read would be silently hidden.
 *
 * The native tool-call id (`tool_use.id`) is the unique, stable identity of an
 * invocation. When a tool stamps it into both its placeholder and its complete
 * `ask:"tool"` payload (as `toolCallId`), the two cards of one invocation share
 * that id and two invocations never do. Tools that do not stamp it fall back to
 * exact-text comparison (the prior behavior), so this is purely additive.
 */

/**
 * Extract the `toolCallId` stamped on an `ask:"tool"` payload string.
 * Returns undefined when the text is not a parseable object, is not a tool
 * payload, or carries no `toolCallId`.
 */
export function getToolCallId(text: string | undefined): string | undefined {
	if (!text) {
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return undefined
	}

	if (!parsed || typeof parsed !== "object") {
		return undefined
	}

	const record = parsed as Record<string, unknown>
	if (typeof record.tool !== "string") {
		return undefined
	}

	return typeof record.toolCallId === "string" && record.toolCallId.length > 0 ? record.toolCallId : undefined
}

/**
 * True when two `ask:"tool"` payload strings belong to the SAME tool
 * invocation - i.e. both carry a `toolCallId` and the ids are equal.
 *
 * Returns false when either side lacks a `toolCallId`, so callers fall back to
 * their exact-text comparison for tools that have not adopted id stamping.
 */
export function isSameToolInvocation(textA: string | undefined, textB: string | undefined): boolean {
	const idA = getToolCallId(textA)
	const idB = getToolCallId(textB)
	return idA !== undefined && idA === idB
}

/** Minimal shape of a clineMessage needed to match an ask:"tool" by id. */
interface ToolAskCandidate {
	type: "ask" | "say"
	ask?: string
	text?: string
}

/**
 * How far back from the tail to look for a tool placeholder. The placeholder
 * is created in the same streaming turn as its complete card, so a small
 * window is sufficient and keeps the scan O(1) regardless of history size.
 */
const TOOL_ASK_LOOKBACK = 50

/**
 * Find the index of the most recent `ask:"tool"` message whose payload carries
 * `toolCallId`, scanning backward from the tail within a bounded window.
 *
 * This makes the streaming placeholder -> complete card transition driven by
 * tool identity rather than tail adjacency: an intervening say (checkpoint,
 * text, reasoning) emitted between handlePartial and execute() can no longer
 * orphan the placeholder. Returns -1 when no match is found or `toolCallId`
 * is empty.
 */
export function findToolAskIndexByCallId(
	messages: readonly ToolAskCandidate[],
	toolCallId: string | undefined,
): number {
	if (!toolCallId) {
		return -1
	}

	const start = messages.length - 1
	const end = Math.max(0, messages.length - TOOL_ASK_LOOKBACK)

	for (let i = start; i >= end; i--) {
		const message = messages[i]
		if (message.type === "ask" && message.ask === "tool" && getToolCallId(message.text) === toolCallId) {
			return i
		}
	}

	return -1
}
