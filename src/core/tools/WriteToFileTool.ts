import path from "path"
import fs from "fs/promises"

import type { ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import { ignorePartialAskRejection } from "../task/AskIgnoredError"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath, createDirectoriesForFile } from "../../utils/fs"
import { stripLineNumbers, everyLineHasLineNumbers } from "../../integrations/misc/extract-text"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { EXPERIMENT_IDS, experiments } from "@roo-code/types"
import { convertNewFileToUnifiedDiff } from "../diff/stats"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getToolStreamState } from "./toolStreamState"
import { applyComputedEdit } from "./helpers/applyComputedEdit"

interface WriteToFileParams {
	path: string
	content: string
}

export class WriteToFileTool extends BaseTool<"write_to_file"> {
	readonly name = "write_to_file" as const

	async execute(params: WriteToFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError } = callbacks
		const relPath = params.path
		// Coerce content to string safely: weak models can emit null/numbers.
		let newContent = typeof params.content === "string" ? params.content : ""

		if (typeof relPath !== "string" || !relPath) {
			this.recordFailure(task, "write_to_file")
			pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "path"))
			await task.diffViewProvider.reset()
			return
		}

		if (params.content === undefined) {
			this.recordFailure(task, "write_to_file")
			pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "content"))
			await task.diffViewProvider.reset()
			return
		}

		// The diff view handlePartial() opened may belong to a truncated path.
		await this.dropDiffSessionForOtherPath(task, relPath)

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		const absolutePath = path.resolve(task.cwd, relPath)

		const fileExists = await this.existsForEdit(task, relPath, absolutePath)

		// Create parent directories early for new files to prevent ENOENT errors
		// in subsequent operations (e.g., diffViewProvider.open, fs.readFile)
		if (!fileExists) {
			await createDirectoriesForFile(absolutePath)
		}

		if (newContent.startsWith("```")) {
			newContent = newContent.split("\n").slice(1).join("\n")
		}

		if (newContent.endsWith("```")) {
			newContent = newContent.split("\n").slice(0, -1).join("\n")
		}

		if (!task.api.getModel().id.includes("claude")) {
			newContent = unescapeHtmlEntities(newContent)
		}

		// Content copied from read_file output keeps its line numbers.
		if (everyLineHasLineNumbers(newContent)) {
			newContent = stripLineNumbers(newContent)
		}

		try {
			task.consecutiveMistakeCount = 0

			const diffViewProvider = task.diffViewProvider
			// A session that is still open belongs to this path (any other one was
			// dropped above): the streaming preview opened it and read the original.
			const originalContent = !fileExists
				? ""
				: diffViewProvider.isEditing
					? diffViewProvider.originalContent
					: await fs.readFile(absolutePath, "utf-8")

			const outcome = await applyComputedEdit(task, relPath, newContent, callbacks, {
				originalContent,
				isNewFile: !fileExists,
				cardTool: fileExists ? "editedExistingFile" : "newFileCreated",
				cardPatch: fileExists ? undefined : convertNewFileToUnifiedDiff(newContent, relPath),
				// A direct write never shows the file, not even a new one.
				showFileOnDirectSave: false,
				openDiffView: async () => {
					if (diffViewProvider.isEditing) {
						return
					}
					const partialMessage = JSON.stringify({
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
						path: getReadablePath(task.cwd, relPath),
						content: newContent,
						isOutsideWorkspace: isPathOutsideWorkspace(absolutePath),
						isProtected: task.rooProtectedController?.isWriteProtected(relPath) || false,
						// Stamp the native tool-call id so the finalized-duplicate dedup links
						// this placeholder to the complete card, whose content differs (raw
						// newContent vs the unified diff shown on approval).
						toolCallId: callbacks.toolCallId,
					} satisfies ClineSayTool)
					await task.ask("tool", partialMessage, true).catch(ignorePartialAskRejection)
					await diffViewProvider.open(relPath, fileExists ? "modify" : "create")
				},
			})
			if (outcome === "rejected") {
				return
			}

			await diffViewProvider.reset()
			this.resetPartialState(task)

			task.processQueuedMessages()
		} catch (error) {
			await handleError("writing file", error as Error, this.name)
			await task.diffViewProvider.reset()
			this.resetPartialState(task)
		}
	}

	/**
	 * Close the diff session if it is open for a path other than `relPath`,
	 * undoing what its open() did (the empty file of a "create", the original
	 * content of a "modify").
	 *
	 * partial-json drops an unfinished escape sequence at the end of a string,
	 * so `"a/b\u0` and `"a/b\u002` both parse as "a/b". When the model streams
	 * `content` before `path`, hasPathStabilized() can accept such a truncated
	 * path and handlePartial() opens the diff view for it. Reusing that session
	 * for the final path would show and save the content under the truncated
	 * one, so both handlePartial() and execute() call this before deciding
	 * whether a session is already open.
	 */
	private async dropDiffSessionForOtherPath(task: Task, relPath: string): Promise<void> {
		const diffViewProvider = task.diffViewProvider
		if (diffViewProvider.isEditing && diffViewProvider.editTypeOf(relPath) === undefined) {
			await diffViewProvider.revertChanges()
		}
	}

	/**
	 * Whether `relPath` is an existing file. Once the diff view is open for
	 * this path, its session answers: open() creates an empty file for a new
	 * one, so asking the disk again would turn "create" into "modify". A
	 * session for a different path (partial-json streamed a truncated path,
	 * TL-2) or no session at all means the disk decides.
	 */
	private async existsForEdit(task: Task, relPath: string, absolutePath: string): Promise<boolean> {
		const sessionEditType = task.diffViewProvider.editTypeOf(relPath)
		if (sessionEditType !== undefined) {
			return sessionEditType === "modify"
		}
		return await fileExistsAtPath(absolutePath)
	}

	override async handlePartial(task: Task, block: ToolUse<"write_to_file">): Promise<void> {
		const relPath: string | undefined = block.params.path
		const newContent: string | undefined = block.params.content

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(task, relPath) || newContent === undefined) {
			return
		}

		// The experiment is read once per streamed call, not once per chunk (CORE-R7 step 3).
		const partialState = getToolStreamState(task, this.name)
		if (partialState.partialPreventFocusDisruption === undefined) {
			const state = await task.providerRef.deref()?.getState()
			partialState.partialPreventFocusDisruption = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)
		}

		if (partialState.partialPreventFocusDisruption) {
			return
		}

		// --- TL-6: validate access BEFORE opening the diff editor ---
		// During partial streaming, a (weak or manipulated) model could stream a
		// roo-ignored secrets file or a path outside the workspace.  Opening the
		// diff editor reads the file's content into the UI before execute()'s
		// access checks run.  Guard the partial phase by skipping open() when
		// access is denied or the path is outside the workspace: execute() will
		// produce the proper structured error in the final phase.
		const absolutePath = path.resolve(task.cwd, relPath!)

		// Memoize the access check result per path so repeated chunks for the same
		// rejected path don't re-validate (and won't spam any UI).
		let accessAllowed: boolean
		if (partialState.lastValidatedPartialPath === relPath && partialState.lastPartialAccessAllowed !== undefined) {
			accessAllowed = partialState.lastPartialAccessAllowed
		} else {
			accessAllowed = task.rooIgnoreController?.validateAccess(relPath!) ?? true
			partialState.lastValidatedPartialPath = relPath
			partialState.lastPartialAccessAllowed = accessAllowed
		}

		if (!accessAllowed) {
			// Skip opening diff editor; execute() will emit the roo-ignore error.
			return
		}

		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)
		if (isOutsideWorkspace) {
			// Outside-workspace writes may be legitimate with approval, but in the
			// partial phase we skip opening the diff editor: defer to execute()'s
			// approval flow which can properly gate the operation.
			return
		}

		// The path may have grown since a truncated prefix of it opened the diff view.
		await this.dropDiffSessionForOtherPath(task, relPath!)

		// relPath is guaranteed non-null after hasPathStabilized
		const fileExists = await this.existsForEdit(task, relPath!, absolutePath)

		// Create parent directories early for new files to prevent ENOENT errors
		// in subsequent operations (e.g., diffViewProvider.open)
		if (!fileExists) {
			await createDirectoriesForFile(absolutePath)
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath!) || false

		const sharedMessageProps: ClineSayTool = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(task.cwd, relPath!),
			content: newContent || "",
			isOutsideWorkspace,
			isProtected: isWriteProtected,
			// Stamp the native tool-call id so this placeholder links to the
			// later complete card under the finalized-duplicate dedup.
			toolCallId: block.id,
		}

		const partialMessage = JSON.stringify(sharedMessageProps)
		await task.ask("tool", partialMessage, block.partial).catch(ignorePartialAskRejection)

		if (newContent) {
			if (!task.diffViewProvider.isEditing) {
				await task.diffViewProvider.open(relPath!, fileExists ? "modify" : "create")
			}

			await task.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				false,
			)
		}
	}
}

export const writeToFileTool = new WriteToFileTool()
