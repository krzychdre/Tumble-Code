import path from "path"

import { type ClineSayTool } from "@roo-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, type ToolCallbacks } from "./BaseTool"
import {
	runStringReplace,
	type StringReplaceHost,
	type StringReplaceProfile,
	toWorkspaceRelativePath,
} from "./EditTool"

interface SearchReplaceParams {
	file_path: string
	old_string: string
	new_string: string
}

/** The texts `search_replace` has always shown the model; kept verbatim. */
const SEARCH_REPLACE_PROFILE: StringReplaceProfile = {
	errorAction: "search and replace",
	identicalStrings: "The 'old_string' and 'new_string' parameters must be different.",
	fileNotFound: (relPath) => `File not found: ${relPath}. Cannot perform search and replace on a non-existent file.`,
	noMatch: () =>
		`No match found for the specified 'old_string'. Please ensure it matches the file contents exactly, including whitespace and indentation.`,
	multipleMatches: (matchCount) =>
		`Found ${matchCount} matches for the specified 'old_string'. This tool can only replace ONE occurrence at a time. Please provide more context (3-5 lines before and after) to uniquely identify the specific instance you want to change.`,
	multipleMatchesError: "multiple_matches",
}

/**
 * `search_replace` is `edit` with `replace_all` always off (CORE-R8). The tool
 * name, its schema and every text the model sees stay as they were: weak
 * models and xAI are given this tool.
 */
export class SearchReplaceTool extends BaseTool<"search_replace"> {
	readonly name = "search_replace" as const

	async execute(params: SearchReplaceParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { file_path, old_string, new_string } = params
		const host: StringReplaceHost = {
			toolName: this.name,
			recordFailure: (options) => this.recordFailure(task, this.name, options),
			resetPartialState: () => this.resetPartialState(task),
		}
		// Only the three schema fields are forwarded, so a stray replace_all in
		// the arguments can never turn this into a replace-all edit.
		await runStringReplace(
			host,
			{ file_path, old_string, new_string, replace_all: false },
			task,
			callbacks,
			SEARCH_REPLACE_PROFILE,
		)
	}

	override async handlePartial(task: Task, block: ToolUse<"search_replace">): Promise<void> {
		const filePath: string | undefined = block.params.file_path
		const oldString: string | undefined = block.params.old_string

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(task, filePath)) {
			return
		}

		let operationPreview: string | undefined
		if (oldString) {
			// Show a preview of what will be replaced
			const preview = oldString.length > 50 ? oldString.substring(0, 50) + "..." : oldString
			operationPreview = `replacing: "${preview}"`
		}

		// Relative path for display (filePath is guaranteed non-null after hasPathStabilized)
		const relPath = toWorkspaceRelativePath(task.cwd, filePath!)

		const absolutePath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath),
			diff: operationPreview,
			isOutsideWorkspace,
			// Stamp the native tool-call id so this placeholder links to the
			// later complete card under the finalized-duplicate dedup.
			toolCallId: block.id,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const searchReplaceTool = new SearchReplaceTool()
