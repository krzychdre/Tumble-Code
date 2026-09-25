import type { ClineSay, ClineSayTool } from "@roo-code/types"

import { getReadablePath } from "../../../utils/path"

/**
 * The part of a task the write result reads: its cwd, `say` for the
 * user-edit row, and what the last save of its diff view left behind.
 */
export interface ToolWriteResultTask {
	readonly cwd: string
	say(type: ClineSay, text?: string): Promise<unknown>
	readonly diffViewProvider: {
		/** Path of the last successful save (diff editor or direct write). */
		readonly lastSavedRelPath?: string
		/** Patch of the changes the user made in the diff editor before approving. */
		readonly userEdits?: string
		/** New diagnostics the save introduced, already formatted. */
		readonly newProblemsMessage?: string
	}
}

/**
 * The tool_result text of a file write, returned after `saveChanges()` or
 * `saveDirectly()` by every file-writing tool (write_to_file, apply_diff and
 * the tools of `applyComputedEdit`). When the user edited the proposed
 * content, it also shows the user's patch in the chat (`user_feedback_diff`).
 *
 * The JSON keys, their order and the notice sentences are what the model
 * reads; weak models depend on them, so `toolWriteResult.spec` pins them
 * literally.
 */
export async function pushToolWriteResult(task: ToolWriteResultTask, isNewFile: boolean): Promise<string> {
	const { lastSavedRelPath: relPath, userEdits, newProblemsMessage } = task.diffViewProvider
	if (!relPath) {
		throw new Error("No file path available in DiffViewProvider")
	}

	if (userEdits) {
		const say: ClineSayTool = {
			tool: isNewFile ? "newFileCreated" : "editedExistingFile",
			path: getReadablePath(task.cwd, relPath),
			diff: userEdits,
		}
		await task.say("user_feedback_diff", JSON.stringify(say))
	}

	const notices = [
		"You do not need to re-read the file, as you have seen all changes",
		"Proceed with the task using these changes as the new baseline.",
		...(userEdits
			? [
					"If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.",
				]
			: []),
	]

	const result: {
		path: string
		operation: "created" | "modified"
		notice: string
		user_edits?: string
		problems?: string
	} = {
		path: relPath,
		operation: isNewFile ? "created" : "modified",
		notice: notices.join(" "),
	}

	if (userEdits) {
		result.user_edits = userEdits
	}

	if (newProblemsMessage) {
		result.problems = newProblemsMessage
	}

	return JSON.stringify(result)
}
