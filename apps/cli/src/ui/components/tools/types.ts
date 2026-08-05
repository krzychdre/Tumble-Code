import type { BulletStatus } from "../primitives/Bullet.js"
import type { ToolData, TUIMessage } from "../../types.js"

export interface ToolRendererProps {
	toolData: ToolData
	rawContent?: string
	/** The originating message, so renderers can read partial/hasPendingToolCalls for bullet status. */
	message?: TUIMessage
}

export type ToolCategory = "file-read" | "file-write" | "search" | "command" | "mode" | "completion" | "other"

/**
 * Derive the bullet status for a tool from its originating message.
 * Running while pending/partial; otherwise success (tool messages are
 * only ever added as completed — there is no error signal in the
 * current message flow; see useMessageHandlers.ts).
 */
export function toolStatusFromMessage(message?: TUIMessage): BulletStatus {
	if (message?.hasPendingToolCalls || message?.partial) {
		return "running"
	}
	return "success"
}

export function getToolCategory(toolName: string): ToolCategory {
	const fileReadTools = ["readFile", "read_file", "skill", "listFilesTopLevel", "listFilesRecursive", "list_files"]

	const fileWriteTools = [
		"editedExistingFile",
		"appliedDiff",
		"apply_diff",
		"newFileCreated",
		"write_to_file",
		"writeToFile",
	]

	const searchTools = ["searchFiles", "search_files", "codebaseSearch", "codebase_search"]
	const commandTools = ["execute_command", "executeCommand"]
	const modeTools = ["switchMode", "switch_mode", "newTask", "new_task", "finishTask"]
	const completionTools = ["attempt_completion", "attemptCompletion", "ask_followup_question", "askFollowupQuestion"]

	if (fileReadTools.includes(toolName)) return "file-read"
	if (fileWriteTools.includes(toolName)) return "file-write"
	if (searchTools.includes(toolName)) return "search"
	if (commandTools.includes(toolName)) return "command"
	if (modeTools.includes(toolName)) return "mode"
	if (completionTools.includes(toolName)) return "completion"
	return "other"
}
