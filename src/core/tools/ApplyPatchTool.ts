import fs from "fs/promises"
import path from "path"

import { type ClineSayTool } from "@roo-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { applyComputedEdit, type EditSaveContext } from "./helpers/applyComputedEdit"
import type { ToolUse } from "../../shared/tools"
import { parsePatch, ParseError, processAllHunks } from "./apply-patch"
import type { ApplyPatchFileChange } from "./apply-patch"

interface ApplyPatchParams {
	patch: string
}

export class ApplyPatchTool extends BaseTool<"apply_patch"> {
	readonly name = "apply_patch" as const

	private static readonly FILE_HEADER_MARKERS = ["*** Add File: ", "*** Delete File: ", "*** Update File: "] as const

	private extractFirstPathFromPatch(patch: string | undefined): string | undefined {
		if (!patch) {
			return undefined
		}

		const lines = patch.split("\n")
		const hasTrailingNewline = patch.endsWith("\n")
		const completeLines = hasTrailingNewline ? lines : lines.slice(0, -1)

		for (const rawLine of completeLines) {
			const line = rawLine.trim()

			for (const marker of ApplyPatchTool.FILE_HEADER_MARKERS) {
				if (!line.startsWith(marker)) {
					continue
				}

				const candidatePath = line.substring(marker.length).trim()
				if (candidatePath.length > 0) {
					return candidatePath
				}
			}
		}

		return undefined
	}

	async execute(params: ApplyPatchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { patch } = params
		const { handleError, pushToolResult } = callbacks

		try {
			// Validate required parameters
			if (!patch) {
				this.recordFailure(task, "apply_patch")
				pushToolResult(await task.sayAndCreateMissingParamError("apply_patch", "patch"))
				return
			}

			// Parse the patch
			let parsedPatch
			try {
				parsedPatch = parsePatch(patch)
			} catch (error) {
				this.recordFailure(task, "apply_patch")
				const errorMessage =
					error instanceof ParseError
						? `Invalid patch format: ${error.message}`
						: `Failed to parse patch: ${error instanceof Error ? error.message : String(error)}`
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			if (parsedPatch.hunks.length === 0) {
				pushToolResult("No file operations found in patch.")
				return
			}

			// Process each hunk
			const readFile = async (filePath: string): Promise<string> => {
				const absolutePath = path.resolve(task.cwd, filePath)
				return await fs.readFile(absolutePath, "utf8")
			}

			let changes: ApplyPatchFileChange[]
			try {
				changes = await processAllHunks(parsedPatch.hunks, readFile)
			} catch (error) {
				this.recordFailure(task, "apply_patch")
				const errorMessage = `Failed to process patch: ${error instanceof Error ? error.message : String(error)}`
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			// Process each file change
			for (const change of changes) {
				const relPath = change.path
				const absolutePath = path.resolve(task.cwd, relPath)

				// Check access permissions
				const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
				if (!accessAllowed) {
					await task.say("rooignore_error", relPath)
					pushToolResult(formatResponse.rooIgnoreError(relPath))
					return
				}

				if (change.type === "add") {
					// Create new file
					await this.handleAddFile(change, absolutePath, relPath, task, callbacks)
				} else if (change.type === "delete") {
					// Delete file (add and update check write protection in applyComputedEdit)
					const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false
					await this.handleDeleteFile(absolutePath, relPath, task, callbacks, isWriteProtected)
				} else if (change.type === "update") {
					// Update file
					await this.handleUpdateFile(change, absolutePath, relPath, task, callbacks)
				}
			}

			task.consecutiveMistakeCount = 0
			task.recordToolUsage("apply_patch")
		} catch (error) {
			await handleError("apply patch", error as Error, this.name)
			await task.diffViewProvider.reset()
		}
	}

	private async handleAddFile(
		change: ApplyPatchFileChange,
		absolutePath: string,
		relPath: string,
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { pushToolResult } = callbacks

		// Check if file already exists
		const fileExists = await fileExistsAtPath(absolutePath)
		if (fileExists) {
			this.recordFailure(task, "apply_patch")
			const errorMessage = `File already exists: ${relPath}. Use Update File instead.`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const newContent = change.newContent || ""

		const outcome = await applyComputedEdit(task, relPath, newContent, callbacks, {
			// A new file: no original content (not even ""), and no empty-diff check.
			originalContent: undefined,
			isNewFile: true,
		})
		if (outcome !== "saved") {
			return
		}

		await task.diffViewProvider.reset()
		task.processQueuedMessages()
	}

	private async handleDeleteFile(
		absolutePath: string,
		relPath: string,
		task: Task,
		callbacks: ToolCallbacks,
		isWriteProtected: boolean,
	): Promise<void> {
		const { askApproval, pushToolResult, toolCallId } = callbacks

		// Check if file exists
		const fileExists = await fileExistsAtPath(absolutePath)
		if (!fileExists) {
			this.recordFailure(task, "apply_patch")
			const errorMessage = `File not found: ${relPath}. Cannot delete a non-existent file.`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath),
			diff: `File will be deleted: ${relPath}`,
			isOutsideWorkspace,
			// Stamp the native tool-call id so the finalized-duplicate dedup
			// links this complete card to its streaming placeholder.
			toolCallId,
		}

		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			content: `Delete file: ${relPath}`,
			isProtected: isWriteProtected,
		} satisfies ClineSayTool)

		const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

		if (!didApprove) {
			pushToolResult("Delete operation was rejected by the user.")
			return
		}

		// Delete the file
		try {
			await fs.unlink(absolutePath)
		} catch (error) {
			const errorMessage = `Failed to delete file '${relPath}': ${error instanceof Error ? error.message : String(error)}`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		task.didEditFile = true
		pushToolResult(`Successfully deleted ${relPath}`)
		task.processQueuedMessages()
	}

	private async handleUpdateFile(
		change: ApplyPatchFileChange,
		absolutePath: string,
		relPath: string,
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { pushToolResult } = callbacks

		// Check if file exists
		const fileExists = await fileExistsAtPath(absolutePath)
		if (!fileExists) {
			this.recordFailure(task, "apply_patch")
			const errorMessage = `File not found: ${relPath}. Cannot update a non-existent file.`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const originalContent = change.originalContent || ""
		const newContent = change.newContent || ""
		const movePath = change.movePath

		const outcome = await applyComputedEdit(task, relPath, newContent, callbacks, {
			originalContent,
			cardIncludesOriginalContent: true,
			reviewRelPath: movePath || relPath,
			// A move writes the new content to the destination and deletes the source.
			save: movePath
				? (context) => this.saveMovedFile(task, callbacks, absolutePath, movePath, newContent, context)
				: undefined,
		})
		if (outcome !== "saved") {
			return
		}

		await task.diffViewProvider.reset()
		task.processQueuedMessages()
	}

	/**
	 * The save step of an update with "*** Move to:", run after the approval.
	 * Returns false (after reporting to the model and resetting the diff view)
	 * when the destination may not be written.
	 */
	private async saveMovedFile(
		task: Task,
		callbacks: ToolCallbacks,
		absolutePath: string,
		movePath: string,
		newContent: string,
		{ writesDirectly, diagnosticsEnabled, writeDelayMs }: EditSaveContext,
	): Promise<boolean> {
		const { pushToolResult } = callbacks
		const moveAbsolutePath = path.resolve(task.cwd, movePath)

		// Validate destination path access permissions
		const moveAccessAllowed = task.rooIgnoreController?.validateAccess(movePath)
		if (!moveAccessAllowed) {
			await task.say("rooignore_error", movePath)
			pushToolResult(formatResponse.rooIgnoreError(movePath))
			await task.diffViewProvider.reset()
			return false
		}

		// Check if destination path is write-protected
		const isMovePathWriteProtected = task.rooProtectedController?.isWriteProtected(movePath) || false
		if (isMovePathWriteProtected) {
			this.recordFailure(task, "apply_patch")
			const errorMessage = `Cannot move file to write-protected path: ${movePath}`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			await task.diffViewProvider.reset()
			return false
		}

		// Check if destination path is outside workspace
		const isMoveOutsideWorkspace = isPathOutsideWorkspace(moveAbsolutePath)
		if (isMoveOutsideWorkspace) {
			this.recordFailure(task, "apply_patch")
			const errorMessage = `Cannot move file to path outside workspace: ${movePath}`
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			await task.diffViewProvider.reset()
			return false
		}

		// Save new content to the new path
		if (writesDirectly) {
			await task.diffViewProvider.saveDirectly(movePath, newContent, false, diagnosticsEnabled, writeDelayMs)
		} else {
			// Write to new path and delete old file
			const parentDir = path.dirname(moveAbsolutePath)
			await fs.mkdir(parentDir, { recursive: true })
			await fs.writeFile(moveAbsolutePath, newContent, "utf8")
		}

		// Delete the original file
		try {
			await fs.unlink(absolutePath)
		} catch (error) {
			console.error(`Failed to delete original file after move: ${error}`)
		}

		await task.fileContextTracker.trackFileContext(movePath, "roo_edited" as RecordSource)
		return true
	}

	override async handlePartial(task: Task, block: ToolUse<"apply_patch">): Promise<void> {
		const patch: string | undefined = block.params.patch
		const candidateRelPath = this.extractFirstPathFromPatch(patch)
		const fallbackDisplayPath = path.basename(task.cwd) || "workspace"
		const resolvedRelPath = candidateRelPath ?? ""
		const absolutePath = path.resolve(task.cwd, resolvedRelPath)
		const displayPath = candidateRelPath ? getReadablePath(task.cwd, candidateRelPath) : fallbackDisplayPath

		let patchPreview: string | undefined
		if (patch) {
			// Show first few lines of the patch
			const lines = patch.split("\n").slice(0, 5)
			patchPreview = lines.join("\n") + (patch.split("\n").length > 5 ? "\n..." : "")
		}

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: displayPath || path.basename(task.cwd) || "workspace",
			diff: patchPreview || "Parsing patch...",
			isOutsideWorkspace: isPathOutsideWorkspace(absolutePath),
			// Stamp the native tool-call id so this placeholder links to the
			// later complete card under the finalized-duplicate dedup.
			toolCallId: block.id,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const applyPatchTool = new ApplyPatchTool()
