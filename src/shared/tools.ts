import { Anthropic } from "@anthropic-ai/sdk"

import type { ClineAsk, ToolProgressStatus, ToolName, GenerateImageParams, ToolParamName } from "@roo-code/types"

// The tool catalog constants moved to @roo-code/types (PKG-6); these
// re-exports keep the `@roo/tools` and `shared/tools` import paths working
// during the migration. The rest of this file is extension-only (it depends
// on the Anthropic SDK types and the tool execution protocol).
export {
	toolParamNames,
	type ToolParamName,
	type ToolGroupConfig,
	TOOL_DISPLAY_NAMES,
	TOOL_GROUPS,
	ALWAYS_AVAILABLE_TOOLS,
	PROTOCOL_TOOL_NAMES,
	TOOL_ALIASES,
} from "@roo-code/types"

export type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

export type AskApproval = (
	type: ClineAsk,
	partialMessage?: string,
	progressStatus?: ToolProgressStatus,
	forceApproval?: boolean,
) => Promise<boolean>

/**
 * @param toolName Tool the failed call was addressed to. Passed through to
 * `formatResponse.toolError` so a malformed call comes back with that tool's minimal
 * valid invocation as a structured field. Optional: generic failures omit it.
 */
export type HandleError = (action: string, error: Error, toolName?: string) => Promise<void>

export type PushToolResult = (content: ToolResponse) => void

export type AskFinishSubTaskApproval = () => Promise<boolean>

export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

/**
 * Type map defining the native (typed) argument structure for each tool.
 * Tools not listed here will fall back to `any` for backward compatibility.
 */
export type NativeToolArgs = {
	access_mcp_resource: { server_name: string; uri: string }
	read_file: import("@roo-code/types").ReadFileToolParams
	read_artifact: { artifact_id: string; search?: string; offset?: number; limit?: number }
	read_command_output: { artifact_id: string; search?: string; offset?: number; limit?: number }
	attempt_completion: { result: string }
	execute_command: { command: string; cwd?: string; timeout?: number | null }
	apply_diff: { path: string; diff: string }
	edit: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }
	search_and_replace: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }
	search_replace: { file_path: string; old_string: string; new_string: string }
	edit_file: { file_path: string; old_string: string; new_string: string; expected_replacements?: number }
	apply_patch: { patch: string }
	list_files: { path: string; recursive?: boolean }
	new_task: { mode: string; message: string; todos?: string }
	run_parallel_tasks: {
		subtasks: Array<{ message: string; mode?: string | null }>
		maxConcurrency?: number | null
	}
	ask_followup_question: {
		question: string
		follow_up: Array<{ text: string; mode?: string }>
	}
	codebase_search: { query: string; path?: string }
	generate_image: GenerateImageParams
	run_slash_command: { command: string; args?: string }
	skill: { skill: string; args?: string }
	search_files: { path: string; regex: string; file_pattern?: string | null }
	search_task_history: { query: string; max_results?: number }
	switch_mode: { mode_slug: string; reason: string }
	update_todo_list: { todos: string }
	use_mcp_tool: { server_name: string; tool_name: string; arguments?: Record<string, unknown> }
	write_to_file: { path: string; content: string }
	tools_load: { names: string[] }
	web_search: { queries: string[] }
	web_fetch: { url: string }
	// Add more tools as they are migrated to native protocol
}

/**
 * Generic ToolUse interface that provides proper typing for both protocols.
 *
 * @template TName - The specific tool name, which determines the nativeArgs type
 */
export interface ToolUse<TName extends ToolName = ToolName> {
	type: "tool_use"
	id?: string // Optional ID to track tool calls
	name: TName
	/**
	 * The original tool name as called by the model (e.g. an alias like "edit_file"),
	 * if it differs from the canonical tool name used for execution.
	 * Used to preserve tool names in API conversation history.
	 */
	originalName?: string
	// params is a partial record, allowing only some or none of the possible parameters to be used
	params: Partial<Record<ToolParamName, string>>
	partial: boolean
	// nativeArgs is properly typed based on TName if it's in NativeToolArgs, otherwise never
	nativeArgs?: TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : never
	/**
	 * Flag indicating whether the tool call used a legacy/deprecated format.
	 * Used for telemetry tracking to monitor migration from old formats.
	 */
	usedLegacyFormat?: boolean
}

/**
 * Represents a native MCP tool call from the model.
 * In native mode, MCP tools are called directly with their prefixed name (e.g., "mcp_serverName_toolName")
 * rather than through the use_mcp_tool wrapper. This type preserves the original tool name
 * so it appears correctly in API conversation history.
 */
export interface McpToolUse {
	type: "mcp_tool_use"
	id?: string // Tool call ID from the API
	/** The original tool name from the API (e.g., "mcp_serverName_toolName") */
	name: string
	/** Extracted server name from the tool name */
	serverName: string
	/** Extracted tool name from the tool name */
	toolName: string
	/** Arguments passed to the MCP tool */
	arguments: Record<string, unknown>
	partial: boolean
}

export type DiffResult =
	| { success: true; content: string; failParts?: DiffResult[] }
	| ({
			success: false
			error?: string
			details?: {
				similarity?: number
				threshold?: number
				matchedRange?: { start: number; end: number }
				searchContent?: string
				bestMatch?: string
			}
			failParts?: DiffResult[]
	  } & ({ error: string } | { failParts: DiffResult[] }))

export interface DiffItem {
	content: string
	startLine?: number
}

export interface DiffStrategy {
	/**
	 * Get the name of this diff strategy for analytics and debugging
	 * @returns The name of the diff strategy
	 */
	getName(): string

	/**
	 * Apply a diff to the original content
	 * @param originalContent The original file content
	 * @param diffContent The diff content in the strategy's format (string for legacy, DiffItem[] for new)
	 * @param startLine Optional line number where the search block starts. If not provided, searches the entire file.
	 * @param endLine Optional line number where the search block ends. If not provided, searches the entire file.
	 * @returns A DiffResult object containing either the successful result or error details
	 */
	applyDiff(
		originalContent: string,
		diffContent: string | DiffItem[],
		startLine?: number,
		endLine?: number,
	): Promise<DiffResult>

	getProgressStatus?(toolUse: ToolUse, result?: any): ToolProgressStatus
}
