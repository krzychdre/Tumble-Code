import type { BaseTool } from "../tools/BaseTool"
import type { DispatchableToolName } from "../tools/toolDescriptors"

import { listFilesTool } from "../tools/ListFilesTool"
import { readFileTool } from "../tools/ReadFileTool"
import { readArtifactTool } from "../tools/ReadArtifactTool"
import { searchTaskHistoryTool } from "../tools/SearchTaskHistoryTool"
import { writeToFileTool } from "../tools/WriteToFileTool"
import { editTool } from "../tools/EditTool"
import { searchReplaceTool } from "../tools/SearchReplaceTool"
import { editFileTool } from "../tools/EditFileTool"
import { applyPatchTool } from "../tools/ApplyPatchTool"
import { searchFilesTool } from "../tools/SearchFilesTool"
import { executeCommandTool } from "../tools/ExecuteCommandTool"
import { useMcpToolTool } from "../tools/UseMcpToolTool"
import { accessMcpResourceTool } from "../tools/accessMcpResourceTool"
import { askFollowupQuestionTool } from "../tools/AskFollowupQuestionTool"
import { switchModeTool } from "../tools/SwitchModeTool"
import { attemptCompletionTool } from "../tools/AttemptCompletionTool"
import { newTaskTool } from "../tools/NewTaskTool"
import { runParallelTasksTool } from "../tools/RunParallelTasksTool"
import { updateTodoListTool } from "../tools/UpdateTodoListTool"
import { runSlashCommandTool } from "../tools/RunSlashCommandTool"
import { skillTool } from "../tools/SkillTool"
import { toolsLoadTool } from "../tools/ToolsLoadTool"
import { generateImageTool } from "../tools/GenerateImageTool"
import { applyDiffTool } from "../tools/ApplyDiffTool"
import { codebaseSearchTool } from "../tools/CodebaseSearchTool"
import { webSearchTool } from "../tools/WebSearchTool"
import { webFetchTool } from "../tools/WebFetchTool"

/**
 * The implementation that runs each dispatchable tool: the `instance` column of the tool
 * descriptor table (`src/core/tools/toolDescriptors.ts`), kept in its own module because
 * importing every tool pulls in VS Code and the Task class, which the modules reading the
 * policy columns must not load.
 *
 * Keyed by the same `DispatchableToolName` type as the descriptor table, so a new tool name
 * does not compile until it has a handler here too.
 */
const TOOL_HANDLERS: Readonly<Record<DispatchableToolName, BaseTool<any>>> = {
	read_file: readFileTool,
	list_files: listFilesTool,
	search_files: searchFilesTool,
	codebase_search: codebaseSearchTool,
	read_artifact: readArtifactTool,
	// `read_command_output` is resolved to `read_artifact` by the alias table before
	// dispatch; it is listed so a replayed legacy block still finds a handler.
	read_command_output: readArtifactTool,
	search_task_history: searchTaskHistoryTool,
	write_to_file: writeToFileTool,
	apply_diff: applyDiffTool,
	edit: editTool,
	search_and_replace: editTool,
	search_replace: searchReplaceTool,
	edit_file: editFileTool,
	apply_patch: applyPatchTool,
	generate_image: generateImageTool,
	execute_command: executeCommandTool,
	use_mcp_tool: useMcpToolTool,
	access_mcp_resource: accessMcpResourceTool,
	web_search: webSearchTool,
	web_fetch: webFetchTool,
	ask_followup_question: askFollowupQuestionTool,
	attempt_completion: attemptCompletionTool,
	switch_mode: switchModeTool,
	new_task: newTaskTool,
	run_parallel_tasks: runParallelTasksTool,
	update_todo_list: updateTodoListTool,
	run_slash_command: runSlashCommandTool,
	skill: skillTool,
	tools_load: toolsLoadTool,
}

/**
 * The handler for a model-supplied name, or undefined for a custom tool or an unknown
 * name. Uses an own-property check, so `constructor` or `__proto__` never match.
 */
export function getToolHandler(name: string): BaseTool<any> | undefined {
	return Object.hasOwn(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name as DispatchableToolName] : undefined
}
