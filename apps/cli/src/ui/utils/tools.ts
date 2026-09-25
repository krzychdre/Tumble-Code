import type { TodoItem } from "@roo-code/types"
import { describeToolPayload } from "@roo-code/core/cli"

import type { ToolData } from "../types.js"

/**
 * Extract structured ToolData from parsed tool JSON: the payload as the shared
 * reader in @roo-code/core sees it (the webview rows read it the same way),
 * plus the fields of the rows the CLI builds itself.
 */
export function extractToolData(toolInfo: Record<string, unknown>): ToolData {
	const toolData: ToolData = describeToolPayload(toolInfo)

	if (typeof toolInfo.output === "string") {
		toolData.output = toolInfo.output
	}
	if (typeof toolInfo.result === "string") {
		toolData.result = toolInfo.result
	}

	return toolData
}

/** Every param but `tool`, one `key: value` line each, values cut at `max` characters. */
function formatParams(toolInfo: Record<string, unknown>, max: number, indent: string): string {
	return Object.entries(toolInfo)
		.filter(([key]) => key !== "tool")
		.map(([key, value]) => {
			const displayValue = typeof value === "string" ? value : JSON.stringify(value)
			const truncated = displayValue.length > max ? displayValue.substring(0, max) + "..." : displayValue
			return `${indent}${key}: ${truncated}`
		})
		.join("\n")
}

/**
 * Format tool ask message for user approval prompt
 */
export function formatToolAskMessage(toolInfo: Record<string, unknown>): string {
	const payload = describeToolPayload(toolInfo)

	switch (payload.kind) {
		case "switchMode": {
			const mode = payload.mode || "unknown"
			return `Switch to ${mode} mode?${payload.reason ? `\nReason: ${payload.reason}` : ""}`
		}

		case "readFile": {
			const files = payload.batchFiles
			if (files && files.length > 0) {
				return `Read ${files.length} file(s)?\n${files.map((f) => `  ${f.path}`).join("\n")}`
			}
			return `Read file: ${payload.path || "(no path)"}`
		}

		case "edit":
		case "insert": {
			const path = payload.path || "(no path)"
			return payload.tool === "newFileCreated" ? `Write to file: ${path}` : `Apply changes to: ${path}`
		}

		default: {
			const params = formatParams(toolInfo, 80, "  ")
			return `${payload.tool}${params ? `\n${params}` : ""}`
		}
	}
}

/**
 * The TODO items of an update_todo_list ask. UpdateTodoListTool sends the
 * list it parsed, as TodoItem[], in both the partial and the final ask; a
 * payload without a list yields null.
 */
export function parseTodosFromToolInfo(toolInfo: Record<string, unknown>): TodoItem[] | null {
	const todosArray = toolInfo.todos
	if (!Array.isArray(todosArray)) {
		return null
	}

	return todosArray
		.map((item: unknown, index) => {
			if (typeof item === "object" && item !== null) {
				const todo = item as Record<string, unknown>
				return {
					id: (todo.id as string) || `todo-${index}`,
					content: (todo.content as string) || "",
					status: ((todo.status as string) || "pending") as TodoItem["status"],
				}
			}
			return null
		})
		.filter((item): item is TodoItem => item !== null)
}
