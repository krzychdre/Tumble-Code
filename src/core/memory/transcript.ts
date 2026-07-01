/**
 * Recent-conversation transcript renderer for the memory extraction sub-agent.
 *
 * Phase 1 of ai_plans/2026-07-01_memory-hook-and-headless-subagent.md.
 *
 * The extraction sub-agent runs *fresh* (Roo can't fork the parent's context —
 * see the parallel-subagents plan), so the prompt that asks it to "analyze the
 * recent messages" must actually *carry* those messages. This module renders a
 * bounded, cheap, weak-model-friendly transcript from the task's
 * `apiConversationHistory` (Anthropic message format).
 *
 * Bounds (keep it small — this rides inside a prompt):
 * - only the last {@link DEFAULT_MAX_MESSAGES} messages,
 * - each message capped at {@link DEFAULT_MAX_CHARS_PER_MESSAGE} chars,
 * - reasoning/thinking blocks dropped (not durable signal),
 * - tool inputs/results summarized and truncated.
 */

import type { Anthropic } from "@anthropic-ai/sdk"

/** An Anthropic message, optionally carrying Roo's `ts` and reasoning fields. */
export interface TranscriptMessage {
	role: "user" | "assistant"
	content: string | Array<Anthropic.Messages.ContentBlockParam>
	/** Roo tags reasoning-only messages; we drop them. */
	type?: string
}

export const DEFAULT_MAX_MESSAGES = 30
export const DEFAULT_MAX_CHARS_PER_MESSAGE = 2000

export interface RenderTranscriptOptions {
	maxMessages?: number
	maxCharsPerMessage?: number
}

/** Truncate `s` to `max` chars with a marker, collapsing trailing whitespace. */
function clamp(s: string, max: number): string {
	const trimmed = s.trimEnd()
	if (trimmed.length <= max) return trimmed
	return trimmed.slice(0, max) + " …[truncated]"
}

/** Best-effort compact stringify of a tool-use input object. */
function summarizeInput(input: unknown, max: number): string {
	if (input === undefined || input === null) return ""
	let text: string
	try {
		text = typeof input === "string" ? input : JSON.stringify(input)
	} catch {
		text = String(input)
	}
	return clamp(text, max)
}

/** Render a single content block to a compact line, or "" to skip it. */
function renderBlock(block: Anthropic.Messages.ContentBlockParam, maxChars: number): string {
	switch (block.type) {
		case "text":
			return clamp(block.text ?? "", maxChars)
		case "tool_use":
			return `→ tool ${block.name}(${summarizeInput(block.input, Math.min(maxChars, 600))})`
		case "tool_result": {
			const c = block.content
			let text: string
			if (typeof c === "string") {
				text = c
			} else if (Array.isArray(c)) {
				text = c.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
			} else {
				text = ""
			}
			return `← result: ${clamp(text, maxChars)}`
		}
		case "image":
			return "[image]"
		default:
			// thinking / reasoning / redacted_thinking / anything else → skip.
			return ""
	}
}

/** Render one message ("User:" / "Assistant:" + body), or "" to skip. */
function renderMessage(msg: TranscriptMessage, maxChars: number): string {
	// Drop reasoning-only messages — not durable memory signal.
	if (msg.type === "reasoning") return ""

	const speaker = msg.role === "assistant" ? "Assistant" : "User"
	let body: string
	if (typeof msg.content === "string") {
		body = clamp(msg.content, maxChars)
	} else {
		body = msg.content
			.map((b) => renderBlock(b, maxChars))
			.filter((line) => line.length > 0)
			.join("\n")
	}
	if (!body.trim()) return ""
	return `${speaker}: ${body}`
}

/**
 * Render the last N messages of `history` into a bounded plain-text transcript.
 * Returns "" when there is nothing worth including.
 */
export function renderTranscript(
	history: ReadonlyArray<TranscriptMessage>,
	options: RenderTranscriptOptions = {},
): string {
	const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES
	const maxChars = options.maxCharsPerMessage ?? DEFAULT_MAX_CHARS_PER_MESSAGE
	if (!Array.isArray(history) || history.length === 0) return ""

	const recent = history.slice(-Math.max(0, maxMessages))
	const rendered = recent.map((m) => renderMessage(m, maxChars)).filter((line) => line.length > 0)
	return rendered.join("\n\n")
}
