import fs from "fs/promises"
import path from "path"

import { type ClineSayTool, isCompactProfile } from "@tumble-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { ignorePartialAskRejection } from "../task/AskIgnoredError"
import { compactResponses, formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import type { ToolUse } from "../../shared/tools"

import { everyLineHasLineNumbers, stripLineNumbers } from "../../integrations/misc/extract-text"

import { BaseTool, ToolCallbacks } from "./BaseTool"
import { applyComputedEdit } from "./helpers/applyComputedEdit"
import { replaceLiteral } from "./helpers/replaceLiteral"
import {
	compactReplace,
	detectLineEnding,
	findClosestSnippet,
	lastLines,
	matchWithContext,
	normalizeToLF,
	restoreLineEnding,
} from "./helpers/compactEdit"

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

/**
 * `edit` under the compact profile (small local models): the lenient matching
 * chain of `compactReplace` and short plain-text errors that quote the file.
 * An empty old_string creates a missing file (or fills an empty one) with
 * new_string as `write_to_file` would write it, and otherwise answers with
 * the file's last lines to append after.
 *
 * The mistake counting is the same as in `runStringReplace`: every failed call
 * goes through `host.recordFailure`, the rooignore block does not, and a saved
 * edit resets the counter.
 */
async function runCompactEdit(
	host: StringReplaceHost,
	params: StringReplaceParams,
	task: Task,
	callbacks: ToolCallbacks,
): Promise<void> {
	const { handleError, pushToolResult } = callbacks
	const { toolName } = host
	const filePath = typeof params.file_path === "string" ? params.file_path : ""
	const oldString = params.old_string
	const newString = params.new_string
	// Non-strict schemas under compact: a model may send the boolean as a string.
	const replaceAll = params.replace_all === true || (params.replace_all as unknown) === "true"

	try {
		if (!filePath) {
			host.recordFailure()
			// Called for its chat row and telemetry; the model gets the short compact text.
			await task.sayAndCreateMissingParamError(toolName, "file_path")
			pushToolResult(compactResponses.missingParameter(toolName, "file_path"))
			return
		}

		// The argument parser lets a call through only with all three fields, but a
		// non-strict schema still lets a model send null or a number.
		if (typeof oldString !== "string") {
			host.recordFailure()
			await task.sayAndCreateMissingParamError(toolName, "old_string")
			pushToolResult(compactResponses.missingParameter(toolName, "old_string"))
			return
		}

		if (typeof newString !== "string") {
			host.recordFailure()
			await task.sayAndCreateMissingParamError(toolName, "new_string")
			pushToolResult(compactResponses.missingParameter(toolName, "new_string"))
			return
		}

		const relPath = toWorkspaceRelativePath(task.cwd, filePath)

		if (!task.rooIgnoreController?.validateAccess(relPath)) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		const absolutePath = path.resolve(task.cwd, relPath)
		const fileExists = await fileExistsAtPath(absolutePath)

		if (!fileExists && oldString !== "") {
			host.recordFailure()
			const errorMessage = compactResponses.editFileNotFound(relPath)
			await task.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		let originalContent = ""
		if (fileExists) {
			try {
				originalContent = await fs.readFile(absolutePath, "utf8")
			} catch (error) {
				host.recordFailure()
				const errorMessage = compactResponses.editReadFailed(
					relPath,
					error instanceof Error ? error.message : String(error),
				)
				await task.say("error", errorMessage)
				pushToolResult(errorMessage)
				return
			}
		}

		const eol = detectLineEnding(originalContent)
		const contentLF = normalizeToLF(originalContent)
		const oldLF = normalizeToLF(oldString)
		const newLF = normalizeToLF(newString)

		let newContent: string
		let resultSuffix = ""
		if (oldLF === "") {
			// Create a missing file, or fill one that holds nothing but whitespace.
			if (fileExists && contentLF.trim() !== "") {
				host.recordFailure({ error: "empty_old_string" })
				pushToolResult(compactResponses.editAppendToExistingFile(relPath, lastLines(contentLF, 3)))
				return
			}
			if (newString === "") {
				host.recordFailure()
				pushToolResult(compactResponses.editEmptyNewString(relPath))
				return
			}
			// As write_to_file without the flag writes it: compact read_file shows no line
			// numbers, so a numbered-looking line is real content (a pipe table) unless the
			// old rule (every line, the last one included) says otherwise.
			newContent = everyLineHasLineNumbers(newString) ? stripLineNumbers(newString) : newString
		} else {
			if (oldLF === newLF) {
				host.recordFailure()
				pushToolResult(compactResponses.editIdenticalStrings(relPath))
				return
			}

			const result = compactReplace(contentLF, oldLF, newLF, replaceAll)

			if (result.kind === "none") {
				host.recordFailure({ error: "no_match" })
				pushToolResult(compactResponses.editNoMatch(relPath, findClosestSnippet(contentLF, result.searched)))
				return
			}

			if (result.kind === "multiple") {
				host.recordFailure()
				pushToolResult(
					compactResponses.editMultipleMatches(
						relPath,
						result.matches.map((match) => match.startLine),
						matchWithContext(contentLF, result.matches[0]),
					),
				)
				return
			}

			newContent = restoreLineEnding(result.content, eol)
			resultSuffix =
				(result.count > 1 ? ` (${result.count} replacements)` : "") +
				compactResponses.editMatchNote(result.strippedLineNumbers, result.strategy === "whitespace")
		}

		if (fileExists && newContent === originalContent) {
			pushToolResult(`No changes needed for '${relPath}'`)
			return
		}

		task.consecutiveMistakeCount = 0

		const isNewFile = !fileExists
		const outcome = await applyComputedEdit(task, relPath, newContent, callbacks, {
			originalContent,
			isNewFile,
			cardTool: isNewFile ? "newFileCreated" : "appliedDiff",
			resultSuffix,
		})
		if (outcome !== "saved") {
			return
		}

		task.recordToolUsage(toolName)
		await task.diffViewProvider.reset()
		host.resetPartialState()

		task.processQueuedMessages()
	} catch (error) {
		await handleError(EDIT_PROFILE.errorAction, error as Error, toolName)
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
		if (isCompactProfile(task.apiConfiguration)) {
			await runCompactEdit(host, params, task, callbacks)
			return
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

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(ignorePartialAskRejection)
	}
}

export const editTool = new EditTool()
