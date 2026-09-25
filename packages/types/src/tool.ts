import { z } from "zod"

/**
 * ToolGroup
 */

export const toolGroups = ["read", "edit", "command", "mcp", "modes", "web"] as const

export const toolGroupsSchema = z.enum(toolGroups)

/**
 * Tool groups that have been removed but may still exist in user config files.
 * Used by schema preprocessing to silently strip these before validation,
 * preventing errors for users with older configs.
 */
export const deprecatedToolGroups: readonly string[] = ["browser"]

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * ToolName
 */

export const toolNames = [
	"execute_command",
	"read_file",
	"read_artifact",
	// Deprecated alias of `read_artifact`, kept in the enum so histories and
	// settings written before the rename still validate. See TOOL_ALIASES.
	"read_command_output",
	"write_to_file",
	"apply_diff",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
	"search_files",
	"search_task_history",
	"list_files",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"codebase_search",
	"update_todo_list",
	"run_slash_command",
	"skill",
	"generate_image",
	"custom_tool",
	"tools_load",
	"run_parallel_tasks",
	"web_search",
	"web_fetch",
] as const

export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>

/**
 * Tool catalog: parameter names, display names, groups, aliases and the
 * always-available and protocol tool lists (moved from src/shared/tools.ts,
 * PKG-6).
 */

export const toolParamNames = [
	"command",
	"path",
	"content",
	"regex",
	"file_pattern",
	"recursive",
	"action",
	"url",
	"coordinate",
	"text",
	"server_name",
	"tool_name",
	"arguments",
	"uri",
	"question",
	"result",
	"diff",
	"mode_slug",
	"reason",
	"line",
	"mode",
	"message",
	"cwd",
	"follow_up",
	"task",
	"size",
	"query",
	"args",
	"skill", // skill tool parameter
	"start_line",
	"end_line",
	"todos",
	"prompt",
	"image",
	// read_file parameters (native protocol)
	"operations", // search_and_replace parameter for multiple operations
	"patch", // apply_patch parameter
	"file_path", // search_replace and edit_file parameter
	"old_string", // search_replace and edit_file parameter
	"new_string", // search_replace and edit_file parameter
	"replace_all", // edit tool parameter for replacing all occurrences
	"expected_replacements", // edit_file parameter for multiple occurrences
	"timeout", // execute_command parameter
	"artifact_id", // read_artifact parameter
	"search", // read_artifact parameter for grep-like search
	"offset", // read_artifact and read_file parameter
	"limit", // read_artifact and read_file parameter
	// read_file indentation mode parameters
	"indentation",
	"anchor_line",
	"max_levels",
	"include_siblings",
	"include_header",
	"max_lines",
	// read_file legacy format parameter (backward compatibility)
	"files",
	"line_ranges",
	// web_search parameter (array of 1-4 queries)
	"queries",
	// search_task_history parameter (`query` is already listed above, shared
	// with codebase_search)
	"max_results",
] as const

export type ToolParamName = (typeof toolParamNames)[number]

// Define tool group configuration
export type ToolGroupConfig = {
	tools: readonly string[]
	alwaysAvailable?: boolean // Whether this group is always available and shouldn't show in prompts view
	customTools?: readonly string[] // Opt-in only tools - only available when explicitly included via model's includedTools
}

export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
	execute_command: "run commands",
	read_file: "read files",
	read_artifact: "read artifacts",
	read_command_output: "read artifacts",
	write_to_file: "write files",
	apply_diff: "apply changes",
	edit: "edit files",
	search_and_replace: "apply changes using search and replace",
	search_replace: "apply single search and replace",
	edit_file: "edit files using search and replace",
	apply_patch: "apply patches using codex format",
	search_files: "search files",
	search_task_history: "search this task's history",
	list_files: "list files",
	use_mcp_tool: "use mcp tools",
	access_mcp_resource: "access mcp resources",
	ask_followup_question: "ask questions",
	attempt_completion: "complete tasks",
	switch_mode: "switch modes",
	new_task: "create new task",
	run_parallel_tasks: "run parallel tasks",
	codebase_search: "codebase search",
	update_todo_list: "update todo list",
	run_slash_command: "run slash command",
	skill: "load skill",
	generate_image: "generate images",
	custom_tool: "use custom tools",
	tools_load: "load deferred tool schemas",
	web_search: "search the web",
	web_fetch: "fetch web pages",
} as const

// Define available tool groups.
export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
	read: {
		// `search_task_history` reads the task's OWN stored conversation, not
		// the workspace, so it carries no file-access risk beyond what the user
		// already saw. It lives in `read` (rather than `command`, next to
		// read_artifact) so every read-capable mode, including the md-only
		// ones, can recover a detail that condense or the pruner took away.
		tools: ["read_file", "search_files", "list_files", "codebase_search", "search_task_history"],
	},
	edit: {
		tools: ["apply_diff", "write_to_file", "generate_image"],
		customTools: ["edit", "search_replace", "edit_file", "apply_patch"],
	},
	command: {
		tools: ["execute_command", "read_artifact"],
	},
	mcp: {
		tools: ["use_mcp_tool", "access_mcp_resource"],
	},
	modes: {
		tools: ["switch_mode", "new_task", "run_parallel_tasks"],
		alwaysAvailable: true,
	},
	// Gated by the global `webToolsEnabled` setting: when it is off the group
	// resolves to no tools at all, so builds with the feature disabled produce
	// byte-identical prompts and tool arrays.
	web: {
		tools: ["web_search", "web_fetch"],
	},
}

// Tools that are always available to all modes.
export const ALWAYS_AVAILABLE_TOOLS: ToolName[] = [
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"update_todo_list",
	"run_slash_command",
	"skill",
	"tools_load",
	"run_parallel_tasks",
] as const

/**
 * Tools whose result is protocol or instructions, not data.
 *
 * These results are consumed by the task machinery or steer the next turn
 * (a skill body, a loaded schema, a slash-command expansion, a mode switch
 * acknowledgement). Shrinking or clearing one changes behaviour rather than
 * saving context, so every context-reduction pass has to leave them alone.
 *
 * Single source of truth for two policies that would otherwise drift:
 * - `SPILL_BYPASS_TOOLS` (`src/core/artifacts/spillPolicy.ts`) never spills them,
 * - `COMPACTABLE_TOOL_NAMES` (`src/core/context-management/microcompact.ts`)
 *   never clears them (it is an allowlist, so they are simply absent from it).
 *
 * A unit test asserts both invariants against this list.
 */
export const PROTOCOL_TOOL_NAMES: readonly string[] = [
	"attempt_completion",
	"ask_followup_question",
	"update_todo_list",
	"switch_mode",
	"new_task",
	"run_parallel_tasks",
	"skill",
	"run_slash_command",
	"tools_load",
	"generate_image",
] as const

/**
 * Central registry of tool aliases.
 * Maps alias name -> canonical tool name.
 *
 * This allows models to use alternative names for tools (e.g., "edit_file" instead of "apply_diff").
 * When a model calls a tool by its alias, the system resolves it to the canonical name for execution,
 * but preserves the alias in API conversation history for consistency.
 *
 * To add a new alias, simply add an entry here. No other files need to be modified.
 */
export const TOOL_ALIASES: Record<string, ToolName> = {
	write_file: "write_to_file",
	search_and_replace: "edit",
	// `read_artifact` generalizes the old command-output-only tool. The old
	// name stays dispatchable so histories written before the rename, and
	// models that learned the old habit, still reach the implementation.
	read_command_output: "read_artifact",
} as const
