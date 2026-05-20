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
