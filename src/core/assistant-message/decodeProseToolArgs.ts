import { decodeLiteralUnicodeEscapes } from "@tumble-code/core"

/**
 * Tools whose string arguments are prose for a person: shown in the chat, passed
 * to a subtask or kept as a todo list, never written to a file or run. Their
 * literal `\uXXXX` escapes are decoded; every other tool keeps its arguments
 * verbatim, because file content and commands may hold such escapes on purpose.
 */
const PROSE_TOOLS: ReadonlySet<string> = new Set([
	"attempt_completion",
	"ask_followup_question",
	"update_todo_list",
	"new_task",
	"run_parallel_tasks",
	"switch_mode",
])

function decodeStrings(value: unknown): unknown {
	if (typeof value === "string") {
		return decodeLiteralUnicodeEscapes(value)
	}
	if (Array.isArray(value)) {
		let changed = false
		const out = value.map((item) => {
			const decoded = decodeStrings(item)
			changed ||= decoded !== item
			return decoded
		})
		return changed ? out : value
	}
	if (typeof value === "object" && value !== null) {
		let out: Record<string, unknown> | undefined
		for (const [key, item] of Object.entries(value)) {
			const decoded = decodeStrings(item)
			if (decoded !== item) {
				out ??= { ...(value as Record<string, unknown>) }
				out[key] = decoded
			}
		}
		return out ?? value
	}
	return value
}

/**
 * Some models (GLM through vLLM, seen in task 01a134d6) write Polish letters in
 * tool arguments as `\\u0142`, so after JSON parsing the argument holds the
 * literal text `\u0142` and the Task Completed block shows it. Once such a call
 * sits in the history, the model copies the pattern in every later turn.
 *
 * Decodes those escapes in the arguments of the prose tools above (outside
 * markdown code). Returns the same object when nothing changed.
 */
export function decodeProseToolArgs<T>(toolName: string, args: T): T {
	return PROSE_TOOLS.has(toolName) ? (decodeStrings(args) as T) : args
}

/**
 * The parser above keeps new tool calls clean, but a task saved before it can
 * still hold escaped prose tool calls in its API history, and the model copies
 * them in every later turn. Applied when a request is built from the stored
 * history: decodes the `input` of assistant `tool_use` blocks of prose tools.
 *
 * Never mutates its argument (the stored history stays as written). Returns the
 * same array, and the same message objects, when nothing changed, which is the
 * common case.
 */
export function decodeProseToolUsesInHistory<M extends { role?: string; content?: unknown }>(messages: M[]): M[] {
	let out: M[] | undefined
	messages.forEach((msg, index) => {
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
			return
		}
		let blocks: unknown[] | undefined
		msg.content.forEach((block: unknown, blockIndex: number) => {
			const toolUse = block as { type?: unknown; name?: unknown; input?: unknown }
			if (toolUse?.type !== "tool_use" || typeof toolUse.name !== "string") {
				return
			}
			const input = decodeProseToolArgs(toolUse.name, toolUse.input)
			if (input !== toolUse.input) {
				blocks ??= [...(msg.content as unknown[])]
				blocks[blockIndex] = { ...toolUse, input }
			}
		})
		if (blocks) {
			out ??= [...messages]
			out[index] = { ...msg, content: blocks }
		}
	})
	return out ?? messages
}
