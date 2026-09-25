import type { ClineAsk, ClineSay, TodoItem, UsableSuggestion } from "@roo-code/types"
import type { ToolPayload } from "@roo-code/core/cli"

export type MessageRole = "system" | "user" | "assistant" | "tool" | "thinking"

/**
 * Structured data a tool row renders: a tool payload as `describeToolPayload`
 * in @roo-code/core reads it (the same reading the webview rows use), plus the
 * fields of the rows the CLI builds itself (`execute_command`,
 * `use_mcp_server`, `attempt_completion`).
 */
export interface ToolData extends ToolPayload {
	/** Command output, for the `execute_command` row. */
	output?: string
	/** Result text, for the `attempt_completion` row. */
	result?: string
}

export interface TUIMessage {
	id: string
	role: MessageRole
	content: string
	toolName?: string
	hasPendingToolCalls?: boolean
	partial?: boolean
	originalType?: ClineAsk | ClineSay
	/** TODO items for update_todo_list tool messages */
	todos?: TodoItem[]
	/** Previous TODO items for diff display */
	previousTodos?: TodoItem[]
	/** Structured tool data for rich rendering */
	toolData?: ToolData
}

export interface PendingAsk {
	id: string
	type: ClineAsk
	content: string
	suggestions?: UsableSuggestion[]
}

export interface TaskHistoryItem {
	id: string
	task: string
	ts: number
	totalCost?: number
	workspace?: string
	mode?: string
	status?: "active" | "completed" | "delegated"
	tokensIn?: number
	tokensOut?: number
}
