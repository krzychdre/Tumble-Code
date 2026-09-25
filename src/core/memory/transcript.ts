/**
 * The conversation signal handed to the memory extraction query.
 *
 * Extraction is one small completion (no agent loop, no tools), and the rules
 * of what is worth remembering (see memoryTypes.ts) all point at what the
 * USER said: preferences, corrections, decisions, external pointers. Tool
 * results, file contents, reasoning and the editor state are exactly the
 * material the rules exclude, so they are dropped here instead of being paid
 * for in every extraction and then ignored by the model.
 *
 * What is kept, in this priority until the budget runs out:
 * 1. the task statement (the first piece of user prose);
 * 2. the assistant's last entry (usually its completion result);
 * 3. the other user prose, newest first: each `<user_message>` body,
 *    including the ones that arrive inside a tool result (answers to
 *    ask_followup_question / attempt_completion, text typed at a running
 *    command), plus the note attached to an approval or denial. Each comes
 *    with the assistant entry right before it, so a reply like "no, use
 *    pnpm" still has the question it answers.
 * The rest of the assistant's narration is left out: in a long autonomous
 * run it would fill the budget and push the user's words out.
 *
 * The output stays in chronological order and is bounded by
 * {@link DEFAULT_MAX_SIGNAL_CHARS} (about 1.5k tokens), small enough for a
 * local model with a 4k context window.
 */

import type { Anthropic } from "@anthropic-ai/sdk"

import { extractEnvelopeFeedback, extractUserInstructions } from "../context-management/ledger/classify"

/** An Anthropic message, optionally carrying Roo's `ts` and reasoning fields. */
export interface TranscriptMessage {
	role: "user" | "assistant"
	content: string | Array<Anthropic.Messages.ContentBlockParam>
	/** Roo tags reasoning-only messages; we drop them. */
	type?: string
}

export const DEFAULT_MAX_SIGNAL_CHARS = 6000
export const MAX_USER_ENTRY_CHARS = 1500
export const MAX_ASSISTANT_ENTRY_CHARS = 300

export interface RenderTranscriptOptions {
	maxChars?: number
}

/** Truncate `s` to `max` chars with a marker, collapsing whitespace runs. */
function clamp(s: string, max: number): string {
	const collapsed = s.replace(/\n{3,}/g, "\n\n").trim()
	if (collapsed.length <= max) return collapsed
	return collapsed.slice(0, max).trimEnd() + " [...]"
}

function textOfToolResult(block: Anthropic.Messages.ToolResultBlockParam): string {
	const c = block.content
	if (typeof c === "string") return c
	if (Array.isArray(c)) return c.map((part) => (part.type === "text" ? part.text : "")).join("\n")
	return ""
}

/** The user prose inside one user message (task statement, replies, approval notes). */
function userEntries(msg: TranscriptMessage): string[] {
	const texts =
		typeof msg.content === "string"
			? [msg.content]
			: msg.content.flatMap((block) => {
					if (block.type === "text") return [block.text ?? ""]
					if (block.type === "tool_result") return [textOfToolResult(block)]
					return []
				})
	const entries: string[] = []
	for (const text of texts) {
		entries.push(...extractUserInstructions(text))
		const feedback = extractEnvelopeFeedback(text)
		if (feedback) entries.push(feedback)
	}
	return entries
}

/** The assistant's visible text and its completion result, if any. */
function assistantEntries(msg: TranscriptMessage): string[] {
	if (msg.type === "reasoning") return []
	if (typeof msg.content === "string") return [msg.content]
	const entries: string[] = []
	for (const block of msg.content) {
		if (block.type === "text" && block.text?.trim()) entries.push(block.text)
		if (block.type === "tool_use" && block.name === "attempt_completion") {
			const result = (block.input as { result?: unknown } | undefined)?.result
			if (typeof result === "string" && result.trim()) entries.push(result)
		}
	}
	return entries
}

/**
 * Render the memory-relevant part of `history` into a bounded plain-text
 * transcript. Returns "" when the history holds no user prose at all, which
 * the caller treats as "nothing to extract" and skips the model call.
 */
export function renderTranscript(
	history: ReadonlyArray<TranscriptMessage>,
	options: RenderTranscriptOptions = {},
): string {
	const maxChars = options.maxChars ?? DEFAULT_MAX_SIGNAL_CHARS
	if (!Array.isArray(history) || history.length === 0) return ""

	// Every entry as its rendered line, in chronological order.
	const lines: Array<{ isUser: boolean; line: string }> = []
	for (const msg of history) {
		const isUser = msg.role === "user"
		for (const entry of isUser ? userEntries(msg) : assistantEntries(msg)) {
			const line = isUser
				? `User: ${clamp(entry, MAX_USER_ENTRY_CHARS)}`
				: `Assistant: ${clamp(entry, MAX_ASSISTANT_ENTRY_CHARS)}`
			lines.push({ isUser, line })
		}
	}
	const userIndexes = lines.flatMap((l, i) => (l.isUser ? [i] : []))
	if (userIndexes.length === 0) return ""

	const selected = new Set<number>()
	let used = 0
	const take = (i: number): boolean => {
		if (i < 0 || selected.has(i)) return true
		const cost = lines[i].line.length + 2
		if (used + cost > maxChars) return false
		selected.add(i)
		used += cost
		return true
	}
	take(userIndexes[0])
	let lastAssistant = lines.length - 1
	while (lastAssistant >= 0 && lines[lastAssistant].isUser) lastAssistant--
	take(lastAssistant)
	for (let k = userIndexes.length - 1; k >= 1; k--) {
		const i = userIndexes[k]
		if (!take(i)) break
		const before = i - 1
		if (before >= 0 && !lines[before].isUser) take(before)
	}
	return [...selected]
		.sort((a, b) => a - b)
		.map((i) => lines[i].line)
		.join("\n\n")
}
