import { nativeTools } from "../prompts/tools/native-tools"

/**
 * One argument of a GLM chat template glued onto the END of a string value:
 * `[\n]<arg_key>NAME</arg_key><arg_value>VALUE[</arg_value>]`, or the same
 * without the `<arg_key>` opener when NAME starts a line. The leading newline
 * belongs to the template (it separates two arguments), the value is one line.
 */
const GLUED_ARG_AT_END =
	/(?:(?:\r?\n)?<arg_key>|\r?\n|^)([A-Za-z_]\w*)<\/arg_key>\s*<arg_value>((?:(?!<\/?arg_(?:key|value)>)[^\r\n])*)(?:<\/arg_value>\s*)?$/

/** Tool name -> names of its string parameters, from the schemas sent to the model. */
let stringParamsByTool: Map<string, ReadonlySet<string>> | undefined

function stringParamsOf(toolName: string): ReadonlySet<string> | undefined {
	stringParamsByTool ??= new Map(
		nativeTools.flatMap((tool) => {
			if (tool.type !== "function") {
				return []
			}
			const properties = (tool.function.parameters?.properties ?? {}) as Record<string, { type?: unknown }>
			const names = Object.entries(properties)
				.filter(
					([, schema]) =>
						schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string")),
				)
				.map(([name]) => name)
			return [[tool.function.name, new Set(names)] as const]
		}),
	)
	return stringParamsByTool.get(toolName)
}

const isMissing = (value: unknown) => value === undefined || value === null || value === ""

/**
 * GLM models write tool calls as `<arg_key>NAME</arg_key><arg_value>VALUE</arg_value>`
 * pairs and the vLLM/SGLang tool parser turns them into JSON arguments. When the
 * model writes a long argument first (`diff` before `path`), that parser sometimes
 * glues the next argument onto the end of the previous value, so the call arrives
 * as `{"diff": "...>>>>>>> REPLACE\npath</arg_key><arg_value>src/main.js"}` and the
 * tool reports a missing `path`.
 *
 * This moves each such tail back into its own argument. It only does so when the
 * tail is at the very end of the value, NAME is a string parameter of this tool's
 * schema, and NAME is missing or empty; anything else (a file that really contains
 * this text) stays verbatim. Returns the same object when nothing was recovered.
 */
export function recoverGluedToolArgs(toolName: string, args: unknown): unknown {
	if (typeof args !== "object" || args === null || Array.isArray(args)) {
		return args
	}
	const input = args as Record<string, unknown>
	let repaired: Record<string, unknown> | undefined

	for (const [key, value] of Object.entries(input)) {
		if (typeof value !== "string" || !value.includes("</arg_key>")) {
			continue
		}
		const declared = stringParamsOf(toolName)
		if (!declared) {
			return args
		}

		let host = value
		const recovered = new Map<string, string>()
		for (let match = GLUED_ARG_AT_END.exec(host); match; match = GLUED_ARG_AT_END.exec(host)) {
			const [, name, glued] = match
			const current = repaired && name in repaired ? repaired[name] : input[name]
			if (name === key || !declared.has(name) || !isMissing(current) || recovered.has(name)) {
				break
			}
			recovered.set(name, glued)
			host = host.slice(0, match.index)
		}

		if (recovered.size > 0) {
			repaired ??= { ...input }
			repaired[key] = host
			for (const [name, glued] of recovered) {
				repaired[name] = glued
			}
		}
	}

	return repaired ?? args
}
