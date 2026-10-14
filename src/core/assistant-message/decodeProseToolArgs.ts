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
