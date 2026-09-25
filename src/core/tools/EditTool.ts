import fs from "fs/promises"
import path from "path"

import { type ClineSayTool } from "@roo-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"
import { applyComputedEdit } from "./helpers/applyComputedEdit"
import { replaceLiteral } from "./helpers/replaceLiteral"

export interface StringReplaceParams {
	file_path: string
	old_string: string
	new_string: string
	replace_all?: boolean
}

/**
 * The model-facing texts and labels of one literal string-replace tool. They
 * differ between `edit` and `search_replace` on purpose: weak models (and xAI,
 * which gets `search_replace`) were prompted with these exact messages.
 */
export interface StringReplaceProfile {
	/** Label given to `handleError` ("Error <action>: ..."). */
	errorAction: string
	identicalStrings: string
	fileNotFound: (relPath: string) => string
	noMatch: (relPath: string) => string
	multipleMatches: (matchCount: number) => string
	/** Error recorded with the mistake for several matches, if any. */
	multipleMatchesError?: string
}

const EDIT_PROFILE: StringReplaceProfile = {
	errorAction: "edit",
	identicalStrings:
		"'old_string' and 'new_string' are identical. No changes needed. If you want to make a change, ensure 'old_string' and 'new_string' are different.",
	fileNotFound: (relPath) => `File not found: ${relPath}. Cannot perform edit on a non-existent file.`,
	noMatch: (relPath) =>
		`No match found for 'old_string' in ${relPath}. Make sure the text to find appears exactly in the file, including whitespace and indentation.`,
	multipleMatches: (matchCount) =>
		`Found ${matchCount} matches of 'old_string' in the file. Use 'replace_all: true' to replace all occurrences, or provide more context in 'old_string' to make it unique.`,
}

/** A path inside or outside the workspace, made relative to it when absolute. */
export function toWorkspaceRelativePath(cwd: string, filePath: string): string {
	return path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
}

/** What the shared string-replace run needs from the calling tool instance. */
export interface StringReplaceHost {
	toolName: "edit" | "search_replace"
	recordFailure: (options?: { error?: string }) => void
	resetPartialState: () => void
}

/**
 * Literal find-and-replace in one file: the shared implementation of `edit`
 * and `search_replace` (CORE-R8). `search_replace` is `edit` with
 * `replace_all` forced off and its own model-facing texts.
 *
 * A function rather than a base class on purpose: the tool modules sit in an
 * import cycle (tool, plan-review gate, Task, tool dispatch table, tool), and
 * `class X extends Base` would read `Base` while the cycle is still loading.
 */
export async function runStringReplace(
	host: StringReplaceHost,
	params: StringReplaceParams,
	task: Task,
	callbacks: ToolCallbacks,
	profile: StringReplaceProfile,
): Promise<void> {
	const { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll } = params
	const { handleError, pushToolResult } = callbacks
	const { toolName } = host

	try {
		// Validate required parameters
		if (!filePath) {
			host.recordFailure()
			pushToolResult(await task.sayAndCreateMissingParamError(toolName, "file_path"))
			return
		}

		if (!oldString) {
			host.recordFailure()
			pushToolResult(await task.sayAndCreateMissingParamError(toolName, "old_string"))
			return
		}

		if (newString === undefined) {
			host.recordFailure()
			pushToolResult(await task.sayAndCreateMissingParamError(toolName, "new_string"))
			return
		}

		if (oldString === newString) {
			host.recordFailure()
			pushToolResult(formatResponse.toolError(profile.identicalStrings))
			return
		}

		const relPath = toWorkspaceRelativePath(task.cwd, filePath)

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		const absolutePath = path.resolve(task.cwd, relPath)

		const fileExists = await fileExistsAtPath(absolutePath)
		if (!fileExists) {
			host.recordFailure()
			const errorMessage = profile.fileNotFound(relPath)
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		let fileContent: string
		try {
			fileContent = await fs.readFile(absolutePath, "utf8")
			// Normalize line endings to LF for consistent matching
			fileContent = fileContent.replace(/\r\n/g, "\n")
		} catch (error) {
			host.recordFailure()
			const errorMessage = `Failed to read file '${relPath}'. Please verify file permissions and try again.`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		// Normalize line endings in old_string/new_string to match file content
		const normalizedOld = oldString.replace(/\r\n/g, "\n")
		const normalizedNew = newString.replace(/\r\n/g, "\n")

		// Count literal occurrences of old_string (not a regex)
		const matchCount = fileContent.split(normalizedOld).length - 1

		if (matchCount === 0) {
			host.recordFailure({ error: "no_match" })
			pushToolResult(formatResponse.toolError(profile.noMatch(relPath)))
			return
		}

		// Uniqueness check when replace_all is not enabled
		if (!replaceAll && matchCount > 1) {
			host.recordFailure({ error: profile.multipleMatchesError })
			pushToolResult(formatResponse.toolError(profile.multipleMatches(matchCount)))
			return
		}

		const newContent = replaceLiteral(fileContent, normalizedOld, normalizedNew, { all: !!replaceAll })

		if (newContent === fileContent) {
			pushToolResult(`No changes needed for '${relPath}'`)
			return
		}

		task.consecutiveMistakeCount = 0

		const outcome = await applyComputedEdit(task, relPath, newContent, callbacks, {
			originalContent: fileContent,
		})
		if (outcome !== "saved") {
			return
		}

		task.recordToolUsage(toolName)
		await task.diffViewProvider.reset()
		host.resetPartialState()

		// Process any queued messages after file edit completes
		task.processQueuedMessages()
	} catch (error) {
		await handleError(profile.errorAction, error as Error, toolName)
		await task.diffViewProvider.reset()
		host.resetPartialState()
	}
}

export class EditTool extends BaseTool<"edit"> {
	readonly name = "edit" as const

	async execute(params: StringReplaceParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const host: StringReplaceHost = {
			toolName: this.name,
			recordFailure: (options) => this.recordFailure(task, this.name, options),
			resetPartialState: () => this.resetPartialState(task),
		}
		await runStringReplace(host, params, task, callbacks, EDIT_PROFILE)
	}

	override async handlePartial(task: Task, block: ToolUse<"edit">): Promise<void> {
		const relPath: string | undefined = block.params.file_path

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(task, relPath)) {
			return
		}

		// relPath is guaranteed non-null after hasPathStabilized
		const absolutePath = path.resolve(task.cwd, relPath!)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath!),
			diff: block.params.old_string ? "1 edit operation" : undefined,
			isOutsideWorkspace,
			// Stamp the native tool-call id so this placeholder links to the
			// later complete card under the finalized-duplicate dedup.
			toolCallId: block.id,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const editTool = new EditTool()
