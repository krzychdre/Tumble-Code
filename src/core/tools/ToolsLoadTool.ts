import type OpenAI from "openai"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { ALWAYS_AVAILABLE_TOOLS } from "../../shared/tools"

interface ToolsLoadParams {
	names: string[]
}

interface LoadedToolPayload {
	name: string
	description: string
	parameters: unknown
}

interface ToolsLoadResult {
	loaded: LoadedToolPayload[]
	already_active: string[]
	unknown: string[]
}

const ALWAYS_LOAD_SET: ReadonlySet<string> = new Set(ALWAYS_AVAILABLE_TOOLS)

/**
 * Meta-tool: resolves deferred tool names back into their full
 * `{name, description, parameters}` schemas and marks them as materialized
 * on the current Task so subsequent turns include them in the active tools
 * array.
 *
 * This is Roo Code's userland port of Claude Code's `ToolSearch` tool.
 * See `ai_plans/deferred-tool-loading.md` §2 for the design contract.
 */
export class ToolsLoadTool extends BaseTool<"tools_load"> {
	readonly name = "tools_load" as const

	async execute(params: ToolsLoadParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			const names = Array.isArray(params?.names) ? params.names : []

			if (names.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("tools_load")
				pushToolResult(
					formatResponse.toolError(
						"`tools_load` requires at least one tool name in `names`. Pass the exact deferred tool names from the system prompt.",
					),
				)
				return
			}

			const directory = task.deferredToolDirectory
			const materialized = task.materializedDeferredTools

			const result: ToolsLoadResult = {
				loaded: [],
				already_active: [],
				unknown: [],
			}

			for (const rawName of names) {
				const name = typeof rawName === "string" ? rawName.trim() : ""
				if (!name) {
					continue
				}

				// Already materialized on this Task or part of the always-load set?
				if (ALWAYS_LOAD_SET.has(name) || materialized?.has(name)) {
					result.already_active.push(name)
					continue
				}

				const entry = directory?.get(name)
				if (!entry) {
					result.unknown.push(name)
					continue
				}

				const fn = (entry as OpenAI.Chat.ChatCompletionFunctionTool).function
				result.loaded.push({
					name: fn.name,
					description: fn.description ?? "",
					parameters: fn.parameters ?? { type: "object", properties: {} },
				})
				materialized?.add(name)
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(formatToolsLoadResult(result))
		} catch (error) {
			await handleError("executing tools_load", error instanceof Error ? error : new Error(String(error)))
		}
	}
}

/**
 * Render the result as a single text block. We use a JSON-with-prelude shape
 * because the model has strong priors on JSON: the prelude is a one-liner
 * telling it what to do next, and the JSON block is the structured payload.
 */
function formatToolsLoadResult(result: ToolsLoadResult): string {
	const lines: string[] = []
	if (result.loaded.length > 0) {
		lines.push(
			`Loaded ${result.loaded.length} tool schema${result.loaded.length === 1 ? "" : "s"}. ` +
				"They are now callable directly on the next turn.",
		)
	}
	if (result.already_active.length > 0) {
		lines.push(
			`${result.already_active.length} tool${result.already_active.length === 1 ? " was" : "s were"} already active — no need to re-load.`,
		)
	}
	if (result.unknown.length > 0) {
		lines.push(
			`Unknown tool name${result.unknown.length === 1 ? "" : "s"}: ${result.unknown.join(", ")}. ` +
				"Check the spelling against the Deferred tools section of the system prompt.",
		)
	}
	if (lines.length === 0) {
		lines.push("No tools resolved.")
	}
	lines.push("```json")
	lines.push(JSON.stringify(result, null, 2))
	lines.push("```")
	return lines.join("\n")
}

export const toolsLoadTool = new ToolsLoadTool()
