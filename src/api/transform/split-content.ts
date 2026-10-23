import { Anthropic } from "@anthropic-ai/sdk"

/** Text and image blocks of a message, in order. */
type NonToolBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam

/**
 * A user message's blocks split into tool results and text/image blocks, each in order.
 * Other block types are dropped (a user message carries no tool_use).
 */
export function splitUserContent(content: Anthropic.Messages.ContentBlockParam[]): {
	nonToolMessages: NonToolBlock[]
	toolMessages: Anthropic.ToolResultBlockParam[]
} {
	const nonToolMessages: NonToolBlock[] = []
	const toolMessages: Anthropic.ToolResultBlockParam[] = []
	for (const part of content) {
		if (part.type === "tool_result") {
			toolMessages.push(part)
		} else if (part.type === "text" || part.type === "image") {
			nonToolMessages.push(part)
		}
	}
	return { nonToolMessages, toolMessages }
}

/**
 * An assistant message's blocks split into tool uses and text/image blocks, each in order.
 * Other block types are dropped (an assistant message carries no tool_result).
 */
export function splitAssistantContent(content: Anthropic.Messages.ContentBlockParam[]): {
	nonToolMessages: NonToolBlock[]
	toolMessages: Anthropic.ToolUseBlockParam[]
} {
	const nonToolMessages: NonToolBlock[] = []
	const toolMessages: Anthropic.ToolUseBlockParam[] = []
	for (const part of content) {
		if (part.type === "tool_use") {
			toolMessages.push(part)
		} else if (part.type === "text" || part.type === "image") {
			nonToolMessages.push(part)
		}
	}
	return { nonToolMessages, toolMessages }
}
