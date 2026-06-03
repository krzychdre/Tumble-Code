import type OpenAI from "openai"

import type { Task } from "./Task"

/**
 * Outcome of an auto-materialization attempt for a direct call to a deferred
 * tool name.
 *
 *  - `ready`    The tool name resolved against the deferred directory AND the
 *               provided args satisfy the JSON schema. The caller should
 *               continue with its normal dispatch path; the model can no
 *               longer be told "schema unknown".
 *  - `guidance` The tool name resolved but the args were missing or invalid.
 *               The caller must push `payload` as the tool_result and skip
 *               actual execution. The model will retry next turn with the
 *               full schema now in the active set.
 */
export type AutoMaterializeOutcome = { kind: "ready" } | { kind: "guidance"; payload: string }

interface AutoMaterializeOptions {
	task: Task
	blockName: string
	nativeArgs: unknown
	experiments?: Record<string, boolean>
}

/**
 * Detect "the model called a deferred tool name directly without using
 * `tools_load` first" and recover gracefully.
 *
 * Returns `null` when:
 *  - the `deferredTools` experiment is disabled (byte-identical behaviour
 *    to today is mandatory in that mode),
 *  - the block name is NOT in the Task's deferred directory (lets the
 *    standard "unknown tool" path fire for genuine typos).
 *
 * Otherwise:
 *  - Adds the name to `task.materializedDeferredTools` so subsequent turns
 *    include the full schema in the active tools array.
 *  - If `nativeArgs` validates against the just-materialized schema,
 *    returns `{ kind: "ready" }` so the caller can continue with normal
 *    dispatch (this turn's call can still run because the underlying
 *    handler — MCP server call, custom tool execute, etc. — already knows
 *    how to use the args; the schema unlock was only a prompting concern).
 *  - If args are missing or invalid, returns `{ kind: "guidance", payload }`
 *    where `payload` is a tool_result string containing the now-known
 *    schema and a retry hint.
 *
 * See `ai_plans/deferred-tool-loading.md` §8.3.
 */
export function tryAutoMaterializeDirectCall(options: AutoMaterializeOptions): AutoMaterializeOutcome | null {
	const { task, blockName, nativeArgs, experiments } = options

	// Gate everything on the experiment so behaviour with it OFF is
	// byte-identical to today.
	if (experiments?.deferredTools !== true) {
		return null
	}

	const directory = task.deferredToolDirectory
	const entry = directory?.get(blockName)
	if (!entry) {
		// Not a deferred-tool name — fall through to the caller's
		// standard "unknown tool" handling. NEVER mutate state.
		return null
	}

	// Materialize: subsequent turns will include the schema in the active set.
	task.materializedDeferredTools?.add(blockName)

	const fn = (entry as OpenAI.Chat.ChatCompletionFunctionTool).function
	const parameters = fn.parameters

	if (areArgsAcceptable(nativeArgs, parameters)) {
		return { kind: "ready" }
	}

	return {
		kind: "guidance",
		payload: buildSchemaGuidance(fn.name, fn.description ?? "", parameters),
	}
}

/**
 * Lightweight acceptance check. We deliberately do NOT pull in a full
 * JSON-Schema validator: most deferred tools (MCP + filesystem custom) have
 * runtime validation downstream. Here we just need to detect the GLM-4.7-FP8
 * failure shape: missing/empty args when the schema declares required fields.
 *
 * Rules:
 *  - `nativeArgs` undefined/null  → unacceptable.
 *  - `nativeArgs` non-object      → unacceptable.
 *  - schema has `required: [...]` → all required keys must appear as own
 *                                    properties of `nativeArgs`.
 *  - schema empty / no required   → any object passes.
 */
function areArgsAcceptable(nativeArgs: unknown, parameters: unknown): boolean {
	if (nativeArgs == null || typeof nativeArgs !== "object") {
		return false
	}
	const args = nativeArgs as Record<string, unknown>

	const schema = parameters as { required?: unknown } | null | undefined
	const required = schema && Array.isArray(schema.required) ? (schema.required as unknown[]) : []
	if (required.length === 0) {
		return true
	}

	for (const key of required) {
		if (typeof key !== "string") continue
		if (!Object.prototype.hasOwnProperty.call(args, key)) {
			return false
		}
	}
	return true
}

/**
 * Build the guidance tool-result for an invalid direct call. Inlines the
 * schema so the model can retry next turn without needing to call
 * `tools_load` separately.
 */
function buildSchemaGuidance(name: string, description: string, parameters: unknown): string {
	const lines: string[] = []
	lines.push(
		`Tool \`${name}\` was deferred but you called it directly. It is now ` +
			`available — retry on the next turn with valid arguments matching ` +
			`the schema below.`,
	)
	if (description) {
		lines.push("")
		lines.push(`Description: ${description}`)
	}
	lines.push("")
	lines.push("Schema (parameters):")
	lines.push("```json")
	lines.push(JSON.stringify(parameters ?? { type: "object", properties: {} }, null, 2))
	lines.push("```")
	return lines.join("\n")
}
