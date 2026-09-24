import type { Anthropic } from "@anthropic-ai/sdk"

/**
 * Block types the local tokenizer (`tiktoken`) knows how to count. Everything
 * else (reasoning, thinking, redacted_thinking, ...) is skipped by the tokenizer
 * anyway, so it is dropped here to keep the payload sent to the worker small.
 */
const COUNTABLE_BLOCK_TYPES = new Set(["text", "image", "tool_use", "tool_result"])

/**
 * Flattens a message history into the content blocks a local token estimate
 * should count (DEF-C16).
 *
 * Shared by every place that estimates the prompt size locally instead of
 * trusting the server: LM Studio (always), OpenAI-compatible handlers when the
 * server omits usage, and TaskApiLoop when the tracked context size is zero.
 * Each used to keep only `text` parts, so read_file output (a tool_result) and
 * tool call arguments (a tool_use) were invisible and auto-condense fired late.
 *
 * A string message becomes one text block; array content keeps the countable
 * blocks as they are, so the tokenizer serialises tool_use and tool_result the
 * same way it does everywhere else.
 */
export function flattenMessagesForTokenCount(
	messages: ReadonlyArray<Anthropic.Messages.MessageParam>,
): Anthropic.Messages.ContentBlockParam[] {
	const blocks: Anthropic.Messages.ContentBlockParam[] = []
	for (const message of messages) {
		if (typeof message.content === "string") {
			blocks.push({ type: "text", text: message.content })
		} else if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (COUNTABLE_BLOCK_TYPES.has(block.type)) {
					blocks.push(block)
				}
			}
		}
	}
	return blocks
}
