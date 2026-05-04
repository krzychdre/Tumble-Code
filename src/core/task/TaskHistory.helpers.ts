import { Anthropic } from "@anthropic-ai/sdk"

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Represents a content block that can be inserted into a message's content array.
 * Uses a flexible type to accommodate provider-specific blocks (thinking, reasoning,
 * thoughtSignature) that extend the standard Anthropic content block types.
 */
export type ContentBlock = Record<string, any>

/**
 * The content field of an Anthropic.MessageParam, which can be:
 * - A string (shorthand for a single text block)
 * - An array of content blocks
 * - undefined (empty/missing content)
 */
export type MessageContent = string | ContentBlock[] | undefined

// ─── Block Builders ────────────────────────────────────────────────────────────

/**
 * Builds an Anthropic thinking block for extended thinking.
 * This format passes through anthropic-filter.ts and is properly round-tripped
 * for interleaved thinking with tool use (required by Anthropic API).
 */
export function buildThinkingBlock(reasoning: string, signature: string): ContentBlock {
	return {
		type: "thinking",
		thinking: reasoning,
		signature: signature,
	}
}

/**
 * Builds a generic reasoning block for non-Anthropic providers.
 * Stores reasoning content with optional summary.
 */
export function buildReasoningBlock(reasoning: string, summary: any[]): ContentBlock {
	return {
		type: "reasoning",
		text: reasoning,
		summary: summary,
	}
}

/**
 * Builds an encrypted reasoning block for OpenAI Native.
 * Stores the encrypted content with optional ID.
 */
export function buildEncryptedReasoningBlock(encryptedContent: string, id?: string): ContentBlock {
	return {
		type: "reasoning",
		summary: [] as any[],
		encrypted_content: encryptedContent,
		...(id ? { id } : {}),
	}
}

/**
 * Builds a thought signature block for non-Anthropic providers (e.g., Gemini 3).
 * Converters can attach this back to the correct provider-specific fields.
 */
export function buildThoughtSignatureBlock(thoughtSignature: string): ContentBlock {
	return {
		type: "thoughtSignature",
		thoughtSignature,
	}
}

// ─── Content Insertion Helpers ─────────────────────────────────────────────────

/**
 * Inserts a block BEFORE the existing content of a message.
 * Used for thinking, reasoning, and encrypted reasoning blocks that must appear
 * before the main content.
 *
 * Handles three cases:
 * - content is undefined → [block]
 * - content is string → [block, { type: "text", text: content }]
 * - content is array → [block, ...content]
 */
export function insertBlockBeforeContent(block: ContentBlock, content: MessageContent): ContentBlock[] {
	if (!content) {
		return [block]
	}
	if (typeof content === "string") {
		return [block, { type: "text", text: content }]
	}
	return [block, ...content]
}

/**
 * Inserts a block AFTER the existing content of a message.
 * Used for thought signature blocks that must appear after the main content.
 *
 * Handles three cases:
 * - content is undefined → [block]
 * - content is string → [{ type: "text", text: content }, block]
 * - content is array → [...content, block]
 */
export function insertBlockAfterContent(block: ContentBlock, content: MessageContent): ContentBlock[] {
	if (!content) {
		return [block]
	}
	if (typeof content === "string") {
		return [{ type: "text", text: content }, block]
	}
	return [...content, block]
}

// ─── User Message Processing ──────────────────────────────────────────────────

/**
 * Converts orphaned tool_result blocks to text blocks when the previous effective
 * message is not an assistant message. This prevents orphaned tool_results from
 * being filtered out by getEffectiveApiHistory.
 *
 * This can happen when condensing occurs after the assistant sends tool_uses but
 * before the user responds — the tool_use blocks get condensed away, leaving
 * orphaned tool_results.
 */
export function convertOrphanedToolResultsToText(
	message: Anthropic.MessageParam,
	lastEffectiveRole: string | undefined,
): Anthropic.MessageParam {
	if (lastEffectiveRole !== "assistant" && Array.isArray(message.content)) {
		return {
			...message,
			content: message.content.map((block) =>
				block.type === "tool_result"
					? {
							type: "text" as const,
							text: `Tool result:\n${typeof block.content === "string" ? block.content : JSON.stringify(block.content)}`,
						}
					: block,
			),
		}
	}
	return message
}
