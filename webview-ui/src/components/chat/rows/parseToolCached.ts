import type { ClineMessage, ClineSayTool } from "@roo-code/types"

import { parseToolPayloadText } from "@roo-code/core/browser"

/** A parsed tool payload. Shared between callers: read it, never mutate it. */
export type ParsedTool = Readonly<Partial<ClineSayTool>> & Readonly<Record<string, unknown>>

// Parsed payloads by message ts. An entry is valid only while the message text
// is the same string: a streamed partial ask changes its text on every token
// and is parsed again, every finished message is parsed once.
//
// The host sends a fresh copy of the whole history on every "state" message,
// so the message objects cannot be the key; ts and text survive the copy.
const cache = new Map<number, { text: string; tool: ParsedTool | undefined }>()

// Bounds the memory kept across tasks in one webview session. When full, the
// oldest insertion goes first (Map keeps insertion order). A single task with
// more parsed messages than this gets no benefit (the history is walked in
// order, so every lookup evicts the entry the next pass needs), which is the
// cost of parsing without the cache, not worse.
export const TOOL_PARSE_CACHE_MAX_ENTRIES = 5000

/**
 * The tool payload of a message (`JSON.parse(message.text)`), or undefined when
 * the message has no text or the text is not a JSON object. The result is
 * cached by `ts` and `text`, so re-deriving the chat rows on every streamed
 * token does not re-parse every tool payload in the history.
 */
export function parseToolCached(message: Pick<ClineMessage, "ts" | "text">): ParsedTool | undefined {
	const text = message.text
	if (!text) {
		return undefined
	}

	const hit = cache.get(message.ts)
	if (hit !== undefined && hit.text === text) {
		// After a full state update the text is an equal but different string,
		// and comparing it walks every character. Keep the newest reference so
		// the next lookups compare by identity.
		hit.text = text
		return hit.tool
	}

	const tool = parseToolPayloadText(text) as ParsedTool | undefined
	if (hit !== undefined) {
		// Keep the insertion order honest: a re-parsed entry counts as new.
		cache.delete(message.ts)
	} else if (cache.size >= TOOL_PARSE_CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value
		if (oldest !== undefined) {
			cache.delete(oldest)
		}
	}
	cache.set(message.ts, { text, tool })
	return tool
}
