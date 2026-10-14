import type { ClineMessage } from "@tumble-code/types"

import { decodeLiteralUnicodeEscapes } from "@tumble-code/core/browser"

// Tasks saved before the host learned to decode prose tool arguments (#893)
// keep text such as `Dok\u0142adnie` (a backslash, `u` and four hex digits)
// where the model escaped Polish letters. The stored files are left alone; the
// webview decodes the prose a person reads when it renders it. File content,
// diffs and commands are never touched: there an escape may be intended.

const decode = (value: unknown) => (typeof value === "string" ? decodeLiteralUnicodeEscapes(value) : value)

/** Says and asks whose text is plain prose (markdown) written by the model. */
const isProseText = (message: ClineMessage) =>
	(message.type === "say" && (message.say === "completion_result" || message.say === "subtask_result")) ||
	(message.type === "ask" && message.ask === "completion_result")

/**
 * The message as it should be shown: the completion text, the subtask result
 * and the follow-up question with its suggested answers decoded. Any other
 * message, and any message without escapes, comes back as the same object.
 */
export function decodeStoredProse(message: ClineMessage): ClineMessage {
	const text = message.text
	if (!text || !text.includes("\\u")) {
		return message
	}

	if (isProseText(message)) {
		const decoded = decodeLiteralUnicodeEscapes(text)
		return decoded === text ? message : { ...message, text: decoded }
	}

	if (message.type === "ask" && message.ask === "followup" && !message.partial) {
		// The text is JSON: decode the parsed strings, since in the JSON the
		// backslash is itself escaped and the decoder rightly leaves `\\u` alone.
		let data: unknown
		try {
			data = JSON.parse(text)
		} catch {
			return message
		}
		if (typeof data !== "object" || data === null || Array.isArray(data)) {
			return message
		}
		const { question, suggest } = data as { question?: unknown; suggest?: unknown }
		const decoded = {
			...data,
			question: decode(question),
			suggest: Array.isArray(suggest)
				? suggest.map((item: unknown) =>
						typeof item === "object" && item !== null
							? { ...item, answer: decode((item as { answer?: unknown }).answer) }
							: item,
					)
				: suggest,
		}
		return { ...message, text: JSON.stringify(decoded) }
	}

	return message
}

/**
 * A parsed tool payload with its prose decoded: the new subtask's
 * instructions, the reason for a mode switch and the todo list items. Other
 * tools (files, diffs, commands) come back as the same object.
 */
export function decodeProseTool<T>(tool: T): T {
	if (typeof tool !== "object" || tool === null) {
		return tool
	}
	const payload = tool as Record<string, unknown>
	switch (payload.tool) {
		case "newTask":
			return { ...tool, content: decode(payload.content) }
		case "switchMode":
			return { ...tool, reason: decode(payload.reason) }
		case "updateTodoList":
			return Array.isArray(payload.todos)
				? {
						...tool,
						todos: payload.todos.map((todo: unknown) =>
							typeof todo === "object" && todo !== null
								? { ...todo, content: decode((todo as { content?: unknown }).content) }
								: todo,
						),
					}
				: tool
		default:
			return tool
	}
}
