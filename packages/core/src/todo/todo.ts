import type { ClineMessage, TodoItem } from "@roo-code/types"

/** Turns a message's text into its tool payload, or undefined when it is not JSON. */
export type ToolPayloadParser = (message: ClineMessage) => unknown

function parseToolPayload(message: ClineMessage): unknown {
	try {
		return JSON.parse(message.text ?? "{}")
	} catch {
		return undefined
	}
}

/**
 * The todos of the latest updateTodoList payload in the history (an `ask:
 * "tool"` or a `say: "user_edit_todos"` whose `todos` is a list), or an empty
 * list when there is none.
 *
 * Walks the history from the end and stops at the first match, so only the
 * messages after the latest update are parsed. The webview passes its cached
 * parser, because it recomputes this on every streamed token.
 */
export function getLatestTodo(
	clineMessages: ClineMessage[],
	parseTool: ToolPayloadParser = parseToolPayload,
): TodoItem[] {
	for (let i = clineMessages.length - 1; i >= 0; i--) {
		const msg = clineMessages[i]!
		const counts = (msg.type === "ask" && msg.ask === "tool") || (msg.type === "say" && msg.say === "user_edit_todos")
		if (!counts) {
			continue
		}

		const item = parseTool(msg) as { tool?: unknown; todos?: unknown } | null | undefined
		if (item && item.tool === "updateTodoList" && Array.isArray(item.todos)) {
			return item.todos as TodoItem[]
		}
	}

	return []
}
