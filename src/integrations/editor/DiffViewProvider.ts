import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

import { type ClineSayTool, DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { createDirectoriesForFile } from "../../utils/fs"
import { arePathsEqual, getReadablePath } from "../../utils/path"
import { formatResponse } from "../../core/prompts/responses"
import { Task } from "../../core/task/Task"

import { DecorationController } from "./DecorationController"
import { DiagnosticsCollector } from "./DiagnosticsCollector"
import { DiffEditorLifecycleManager, DIFF_VIEW_URI_SCHEME, DIFF_VIEW_LABEL_CHANGES } from "./DiffEditorLifecycleManager"
import { stripAllBOMs } from "./stripAllBOMs"

// Re-export the constants so existing imports from this module continue to work.
export { DIFF_VIEW_URI_SCHEME, DIFF_VIEW_LABEL_CHANGES }

/**
 * All in-flight state for one diff-edit session. Created atomically by `open()`
 * and detached atomically by `reset()`. Async methods capture the reference once
 * at entry and use the local from then on, so a concurrent `reset()` that nulls
 * `DiffViewProvider.activeEdit` cannot make the in-flight method dereference
 * undefined fields. The `isStale` flag lets the in-flight method skip side
 * effects on an already-closed editor after its awaits resume.
 */
interface ActiveEdit {
	readonly id: number
	readonly relPath: string
	readonly diffEditor: vscode.TextEditor
	readonly fadedOverlay: DecorationController
	readonly activeLine: DecorationController
	readonly preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][]
	readonly documentWasOpen: boolean
	readonly createdDirs: string[]
	streamedLines: string[]
	newContent?: string
	isStale: boolean
}

// TODO: https://github.com/cline/cline/pull/3354
export class DiffViewProvider {
	// Properties to store the results of saveChanges
	newProblemsMessage?: string
	userEdits?: string
	editType?: "create" | "modify"
	isEditing = false
	originalContent: string | undefined
	// Path of the last successfully saved edit. Outlives `activeEdit` because
	// `pushToolWriteResult()` is called after `saveChanges()` / `saveDirectly()`
	// and needs to know which file was just written.
	private lastEditedRelPath?: string

	/** Path of the last successfully saved edit (see `lastEditedRelPath`) —
	 * lets post-save consumers verify `originalContent` belongs to their file. */
	get lastSavedRelPath(): string | undefined {
		return this.lastEditedRelPath
	}
	private activeEdit?: ActiveEdit
	// Snapshot of the most recently buffered final content + path, published by
	// update() once isFinal=true has settled the document. Drained by
	// saveChanges() / saveDirectly(), cleared by revertChanges() / open().
	// Survives reset() on purpose: a reset that races between askApproval() and
	// saveChanges() must not silently drop an already-approved write.
	private pendingSave?: { relPath: string; newContent: string }
	private nextEditId = 0
	private taskRef: WeakRef<Task>
	private diagnostics: DiagnosticsCollector
	private lifecycle: DiffEditorLifecycleManager

	constructor(
		private cwd: string,
		task: Task,
	) {
		this.taskRef = new WeakRef(task)
		this.diagnostics = new DiagnosticsCollector(cwd, task)
		this.lifecycle = new DiffEditorLifecycleManager(cwd)
	}

	async open(relPath: string): Promise<void> {
		const fileExists = this.editType === "modify"
		const absolutePath = path.resolve(this.cwd, relPath)
		this.isEditing = true
		// A new diff session must not inherit a recovery buffer from a prior
		// session. Successful saves drain it; this defensive clear protects
		// against paths that left the buffer set without a save.
		this.pendingSave = undefined

		// If the file is already open, ensure it's not dirty before getting its
		// contents.
		if (fileExists) {
			const existingDocument = vscode.workspace.textDocuments.find(
				(doc) => doc.uri.scheme === "file" && arePathsEqual(doc.uri.fsPath, absolutePath),
			)

			if (existingDocument && existingDocument.isDirty) {
				await existingDocument.save()
			}
		}

		// Get diagnostics before editing the file, we'll compare to diagnostics
		// after editing to see if cline needs to fix anything.
		const preDiagnostics = this.diagnostics.capturePreDiagnostics()

		if (fileExists) {
			this.originalContent = await fs.readFile(absolutePath, "utf-8")
		} else {
			this.originalContent = ""
		}

		// For new files, create any necessary directories and keep track of new
		// directories to delete if the user denies the operation.
		const createdDirs = await createDirectoriesForFile(absolutePath)

		// Make sure the file exists before we open it.
		if (!fileExists) {
			await fs.writeFile(absolutePath, "")
		}

		// Close the tab if it's open (it's already saved above).
		const documentWasOpen = await this.lifecycle.closeFileTabs(absolutePath)

		const diffEditor = await this.lifecycle.openDiffEditor(relPath, this.editType, this.originalContent)
		const fadedOverlay = new DecorationController("fadedOverlay", diffEditor)
		const activeLine = new DecorationController("activeLine", diffEditor)
		// Apply faded overlay to all lines initially.
		fadedOverlay.addLines(0, diffEditor.document.lineCount)
		this.lifecycle.scrollEditorToLine(diffEditor, 0)

		// Atomic install of the new session — any concurrent `reset()` after
		// this point will detach via `activeEdit = undefined` and `isStale = true`,
		// while in-flight methods that already captured the reference stay safe.
		this.activeEdit = {
			id: ++this.nextEditId,
			relPath,
			diffEditor,
			fadedOverlay,
			activeLine,
			preDiagnostics,
			documentWasOpen,
			createdDirs,
			streamedLines: [],
			newContent: undefined,
			isStale: false,
		}
	}

	async update(accumulatedContent: string, isFinal: boolean) {
		const edit = this.activeEdit
		if (!edit) {
			throw new Error("Required values not set")
		}

		if (isFinal) {
			// Preserve empty last line if original content had one. Hoisted from
			// just-before-the-final-WorkspaceEdit so the recovery buffer published
			// below holds exactly the bytes the final replace would write.
			const hasEmptyLastLine = this.originalContent?.endsWith("\n")
			if (hasEmptyLastLine && !accumulatedContent.endsWith("\n")) {
				accumulatedContent += "\n"
			}
			// Publish the recovery snapshot BEFORE any await in this method. The
			// isFinal block below has up to three sequential applyEdit awaits,
			// each followed by `if (edit.isStale) return`. If reset() races any
			// of them, update() bails before reaching the tail-end pendingSave
			// publication site, leaving the buffer empty. saveChanges() then takes
			// its "nothing to save" early-return without setting lastEditedRelPath,
			// and pushToolWriteResult() crashes with "No file path available in
			// DiffViewProvider". Setting pendingSave here keeps the approved bytes
			// intact for flushPendingSaveDirectly() to recover from no matter
			// which stale-check bails.
			this.pendingSave = { relPath: edit.relPath, newContent: stripAllBOMs(accumulatedContent) }
		}

		edit.newContent = accumulatedContent
		const accumulatedLines = accumulatedContent.split("\n")

		if (!isFinal) {
			accumulatedLines.pop() // Remove the last partial line only if it's not the final update.
		}

		const document = edit.diffEditor.document

		// Place cursor at the beginning of the diff editor to keep it out of
		// the way of the stream animation, but do this without stealing focus
		const beginningOfDocument = new vscode.Position(0, 0)
		edit.diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		const endLine = accumulatedLines.length
		// Replace all content up to the current line with accumulated lines.
		const partialEdit = new vscode.WorkspaceEdit()
		const rangeToReplace = new vscode.Range(0, 0, endLine, 0)
		const contentToReplace =
			accumulatedLines.slice(0, endLine).join("\n") + (accumulatedLines.length > 0 ? "\n" : "")
		partialEdit.replace(document.uri, rangeToReplace, stripAllBOMs(contentToReplace))
		await vscode.workspace.applyEdit(partialEdit)
		if (edit.isStale) return // session was reset during the await

		// Update decorations.
		edit.activeLine.setActiveLine(endLine)
		edit.fadedOverlay.updateOverlayAfterLine(endLine, document.lineCount)
		// Scroll to the current line without stealing focus.
		const ranges = edit.diffEditor.visibleRanges
		if (ranges && ranges.length > 0 && ranges[0].start.line < endLine && ranges[0].end.line > endLine) {
			this.lifecycle.scrollEditorToLine(edit.diffEditor, endLine)
		}

		// Update the streamedLines with the new accumulated content.
		edit.streamedLines = accumulatedLines

		if (isFinal) {
			// Handle any remaining lines if the new content is shorter than the
			// original.
			if (edit.streamedLines.length < document.lineCount) {
				const trimEdit = new vscode.WorkspaceEdit()
				trimEdit.delete(document.uri, new vscode.Range(edit.streamedLines.length, 0, document.lineCount, 0))
				await vscode.workspace.applyEdit(trimEdit)
				if (edit.isStale) return
			}

			// Apply the final content. (EOL adjustment and pendingSave publication
			// already happened at the top of the isFinal branch above — before any
			// await — so a reset() racing this final applyEdit still leaves the
			// recovery buffer intact.)
			const finalEdit = new vscode.WorkspaceEdit()

			finalEdit.replace(
				document.uri,
				new vscode.Range(0, 0, document.lineCount, 0),
				stripAllBOMs(accumulatedContent),
			)

			await vscode.workspace.applyEdit(finalEdit)
			if (edit.isStale) return

			// Clear all decorations at the end (after applying final edit).
			edit.fadedOverlay.clear()
			edit.activeLine.clear()
		}
	}

	async saveChanges(
		diagnosticsEnabled: boolean = true,
		writeDelayMs: number = DEFAULT_WRITE_DELAY_MS,
	): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		finalContent: string | undefined
	}> {
		const edit = this.activeEdit
		const pending = this.pendingSave

		// Genuinely nothing to save — open() never reached the buffered-content stage.
		if ((!edit || edit.newContent === undefined || edit.isStale) && !pending) {
			return { newProblemsMessage: undefined, userEdits: undefined, finalContent: undefined }
		}

		// Recovery branch: the diff session was detached or marked stale by a
		// concurrent reset() (typically TaskStreamProcessor.resetStreamingState()
		// firing between askApproval() and saveChanges()). The user already
		// approved the change — flush the buffered content directly to disk
		// instead of silently dropping it.
		if (!edit || edit.newContent === undefined || edit.isStale) {
			return await this.flushPendingSaveDirectly(pending!, edit?.preDiagnostics, diagnosticsEnabled, writeDelayMs)
		}

		const absolutePath = path.resolve(this.cwd, edit.relPath)
		this.lastEditedRelPath = edit.relPath
		const updatedDocument = edit.diffEditor.document
		const editedContent = updatedDocument.getText()

		// Post-await staleness recovery: a concurrent reset() can flip
		// edit.isStale during any of the awaits below. The bytes the user
		// approved must still reach disk — fall through to flushPendingSaveDirectly()
		// which is idempotent (it may rewrite content the editor save already
		// persisted, but disk state stays correct).
		const recoverIfStale = async (): Promise<{
			newProblemsMessage: string | undefined
			userEdits: string | undefined
			finalContent: string | undefined
		} | null> => {
			if (!edit.isStale) return null
			const buffer = pending ?? { relPath: edit.relPath, newContent: edit.newContent! }
			return await this.flushPendingSaveDirectly(buffer, edit.preDiagnostics, diagnosticsEnabled, writeDelayMs)
		}

		// Editor's save() returns Thenable<boolean>: false means VS Code silently
		// refused to write (read-only document, disposed buffer, locked file,
		// internal error). The prior arrangement discarded the boolean and
		// reported success even when no bytes reached disk—manifesting as a
		// silent no-save with no error in dev tools. Capture it and treat
		// false the same as a stale-session detach: fall through to
		// flushPendingSaveDirectly() so the user-approved bytes still land on disk.
		//
		// The !isDirty branch is symmetric: VS Code believes the buffer matches
		// disk (typically autosave fired between update() and saveChanges()),
		// but if pendingSave is populated we still need to guarantee those exact
		// bytes are on disk — autosave may have captured an intermediate or
		// pre-edit state. flushPendingSaveDirectly() is idempotent.
		const fallbackToDirectWrite = async () => {
			const buffer = pending ?? { relPath: edit.relPath, newContent: edit.newContent! }
			return await this.flushPendingSaveDirectly(buffer, edit.preDiagnostics, diagnosticsEnabled, writeDelayMs)
		}

		if (updatedDocument.isDirty) {
			const saved = await updatedDocument.save()
			const recovered = await recoverIfStale()
			if (recovered) return recovered
			if (!saved) {
				console.warn(
					`[DiffViewProvider] saveChanges: editor save() returned false for ${edit.relPath}; falling back to direct disk write`,
				)
				return await fallbackToDirectWrite()
			}
		} else if (pending) {
			// Buffer published by update(isFinal=true) but VS Code thinks the
			// document is clean — write through to guarantee disk matches the
			// approved content.
			return await fallbackToDirectWrite()
		}

		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false, preserveFocus: true })
		const recoveredAfterShow = await recoverIfStale()
		if (recoveredAfterShow) return recoveredAfterShow

		await this.closeAllDiffViews()
		const recoveredAfterClose = await recoverIfStale()
		if (recoveredAfterClose) return recoveredAfterClose

		// Getting diagnostics before and after the file edit is a better approach than
		// automatically tracking problems in real-time. This method ensures we only
		// report new problems that are a direct result of this specific edit.
		// Since these are new problems resulting from Roo's edit, we know they're
		// directly related to the work he's doing. This eliminates the risk of Roo
		// going off-task or getting distracted by unrelated issues, which was a problem
		// with the previous auto-debug approach. Some users' machines may be slow to
		// update diagnostics, so this approach provides a good balance between automation
		// and avoiding potential issues where Roo might get stuck in loops due to
		// outdated problem information. If no new problems show up by the time the user
		// accepts the changes, they can always debug later using the '@problems' mention.
		// This way, Roo only becomes aware of new problems resulting from his edits
		// and can address them accordingly. If problems don't change immediately after
		// applying a fix, won't be notified, which is generally fine since the
		// initial fix is usually correct and it may just take time for linters to catch up.

		const newProblemsMessage = await this.diagnostics.collectPostSaveDiagnostics(
			edit.preDiagnostics,
			diagnosticsEnabled,
			writeDelayMs,
		)

		const recoveredAfterDiagnostics = await recoverIfStale()
		if (recoveredAfterDiagnostics) return recoveredAfterDiagnostics

		// If the edited content has different EOL characters, we don't want to
		// show a diff with all the EOL differences.
		const newContentEOL = edit.newContent.includes("\r\n") ? "\r\n" : "\n"

		// Normalize EOL characters without trimming content
		const normalizedEditedContent = editedContent.replace(/\r\n|\n/g, newContentEOL)

		// Just in case the new content has a mix of varying EOL characters.
		const normalizedNewContent = edit.newContent.replace(/\r\n|\n/g, newContentEOL)

		// Editor save succeeded — drain the recovery buffer.
		this.pendingSave = undefined

		if (normalizedEditedContent !== normalizedNewContent) {
			// User made changes before approving edit.
			const userEdits = formatResponse.createPrettyPatch(
				edit.relPath.toPosix(),
				normalizedNewContent,
				normalizedEditedContent,
			)

			// Store the results as class properties for formatFileWriteResponse to use
			this.newProblemsMessage = newProblemsMessage
			this.userEdits = userEdits

			return { newProblemsMessage, userEdits, finalContent: normalizedEditedContent }
		} else {
			// No changes to Roo's edits.
			// Store the results as class properties for formatFileWriteResponse to use
			this.newProblemsMessage = newProblemsMessage
			this.userEdits = undefined

			return { newProblemsMessage, userEdits: undefined, finalContent: normalizedEditedContent }
		}
	}

	/**
	 * Recovery path for saveChanges(): the diff session was detached or marked
	 * stale by a concurrent reset() before the editor save could complete, but
	 * the user already approved the buffered content. Write the bytes directly
	 * to disk and run the same post-save diagnostics flow saveDirectly() uses.
	 *
	 * Mirrors the file-IO and diagnostics shape of saveDirectly() so that the
	 * recovery path is observably equivalent to a successful editor save —
	 * pushToolWriteResult() consumes lastEditedRelPath / newProblemsMessage /
	 * userEdits the same way regardless of branch.
	 */
	private async flushPendingSaveDirectly(
		pending: { relPath: string; newContent: string },
		preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] | undefined,
		diagnosticsEnabled: boolean,
		writeDelayMs: number,
	): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		finalContent: string | undefined
	}> {
		console.warn(
			`[DiffViewProvider] saveChanges: diff session went stale before save completed; flushing approved content directly to disk for ${pending.relPath}`,
		)

		const absolutePath = path.resolve(this.cwd, pending.relPath)
		await createDirectoriesForFile(absolutePath)
		await fs.writeFile(absolutePath, pending.newContent, "utf-8")

		// The diff editor tab from the (now-stale) session is still open. The
		// editor-branch save path closes it via closeAllDiffViews(); this recovery
		// branch must do the same, otherwise the tab is orphaned — left open,
		// still flagged dirty (fs.writeFile does not notify VS Code), showing
		// stale content even though disk is correct. closeAllDiffViews() now
		// reverts a dirty Roo diff tab to disk before closing it, so the leftover
		// tab is cleaned up here too.
		await this.closeAllDiffViews()

		const newProblemsMessage = await this.diagnostics.collectPostSaveDiagnostics(
			preDiagnostics,
			diagnosticsEnabled,
			writeDelayMs,
		)

		this.lastEditedRelPath = pending.relPath
		this.newProblemsMessage = newProblemsMessage
		this.userEdits = undefined
		this.pendingSave = undefined

		return { newProblemsMessage, userEdits: undefined, finalContent: pending.newContent }
	}

	/**
	 * Formats a standardized response for file write operations
	 *
	 * @param task Task instance to get protocol info
	 * @param cwd Current working directory for path resolution
	 * @param isNewFile Whether this is a new file or an existing file being modified
	 * @returns Formatted message (JSON)
	 */
	async pushToolWriteResult(task: Task, cwd: string, isNewFile: boolean): Promise<string> {
		const relPath = this.lastEditedRelPath
		if (!relPath) {
			throw new Error("No file path available in DiffViewProvider")
		}

		// Only send user_feedback_diff if userEdits exists
		if (this.userEdits) {
			// Create say object for UI feedback
			const say: ClineSayTool = {
				tool: isNewFile ? "newFileCreated" : "editedExistingFile",
				path: getReadablePath(cwd, relPath),
				diff: this.userEdits,
			}

			// Send the user feedback
			await task.say("user_feedback_diff", JSON.stringify(say))
		}

		// Build notices array
		const notices = [
			"You do not need to re-read the file, as you have seen all changes",
			"Proceed with the task using these changes as the new baseline.",
			...(this.userEdits
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

		if (this.userEdits) {
			result.user_edits = this.userEdits
		}

		if (this.newProblemsMessage) {
			result.problems = this.newProblemsMessage
		}

		return JSON.stringify(result)
	}

	async revertChanges(): Promise<void> {
		const edit = this.activeEdit
		if (!edit) {
			// No active session, but a recovery buffer may have leaked from an
			// earlier sequence. Discard it — revert means the user rejected the
			// content; it must not survive into a later save.
			this.pendingSave = undefined
			return
		}
		// User rejected the change; discard the recovery buffer so a later
		// saveChanges() cannot resurrect it.
		this.pendingSave = undefined

		const fileExists = this.editType === "modify"
		const updatedDocument = edit.diffEditor.document
		const absolutePath = path.resolve(this.cwd, edit.relPath)

		if (!fileExists) {
			if (updatedDocument.isDirty) {
				await updatedDocument.save()
			}

			await this.closeAllDiffViews()
			await fs.unlink(absolutePath)

			// Remove only the directories we created, in reverse order.
			for (let i = edit.createdDirs.length - 1; i >= 0; i--) {
				await fs.rmdir(edit.createdDirs[i])
			}
		} else {
			// Revert document.
			const revertEdit = new vscode.WorkspaceEdit()

			const fullRange = new vscode.Range(
				updatedDocument.positionAt(0),
				updatedDocument.positionAt(updatedDocument.getText().length),
			)

			revertEdit.replace(updatedDocument.uri, fullRange, stripAllBOMs(this.originalContent ?? ""))

			// Apply the edit and save, since contents shouldn't have changed
			// this won't show in local history unless of course the user made
			// changes and saved during the edit.
			await vscode.workspace.applyEdit(revertEdit)
			await updatedDocument.save()

			if (edit.documentWasOpen) {
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
					preview: false,
					preserveFocus: true,
				})
			}

			await this.closeAllDiffViews()
		}

		// Edit is done.
		await this.reset()
	}

	scrollToFirstDiff() {
		const edit = this.activeEdit
		if (!edit) {
			return
		}

		this.lifecycle.scrollToFirstDiff(edit.diffEditor, this.originalContent)
	}

	/**
	 * Delegates to the lifecycle manager. Kept as a method on the provider so
	 * that tests can mock the tab-close behavior without setting up the full
	 * lifecycle collaborator.
	 */
	async closeAllDiffViews(): Promise<void> {
		await this.lifecycle.closeAllDiffViews()
	}

	async reset(): Promise<void> {
		// Detach the session atomically before closing diff views (which awaits).
		// Any in-flight method that captured `edit` keeps a live reference and
		// will see `isStale === true` after its own awaits resume, so it can
		// short-circuit instead of touching the closed editor.
		//
		// NOTE: pendingSave is intentionally NOT cleared here. saveChanges() and
		// saveDirectly() drain it on success; revertChanges() / open() clear it.
		// Preserving it across reset() is what allows saveChanges() to recover an
		// already-approved write when resetStreamingState() races with the tool
		// execution between askApproval() and saveChanges().
		const edit = this.activeEdit
		this.activeEdit = undefined
		this.editType = undefined
		this.isEditing = false
		this.originalContent = undefined
		if (edit) {
			edit.isStale = true
		}
		await this.closeAllDiffViews()
	}

	/**
	 * Directly save content to a file without showing diff view
	 * Used when preventFocusDisruption experiment is enabled
	 *
	 * @param relPath - Relative path to the file
	 * @param content - Content to write to the file
	 * @param openFile - Whether to show the file in editor (false = open in memory only for diagnostics)
	 * @returns Result of the save operation including any new problems detected
	 */
	async saveDirectly(
		relPath: string,
		content: string,
		openFile: boolean = true,
		diagnosticsEnabled: boolean = true,
		writeDelayMs: number = DEFAULT_WRITE_DELAY_MS,
	): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		finalContent: string | undefined
	}> {
		const absolutePath = path.resolve(this.cwd, relPath)

		// Get diagnostics before editing the file. Local capture: this path does
		// not own a diff session, so the snapshot lives on the stack only.
		const preDiagnostics = this.diagnostics.capturePreDiagnostics()

		// Capture the pre-write content so consumers of `originalContent`
		// (e.g. the plan-review baseline) see this edit, not a stale one from
		// an earlier diff session.
		try {
			this.originalContent = await fs.readFile(absolutePath, "utf-8")
		} catch {
			this.originalContent = ""
		}

		// Write the content directly to the file
		await createDirectoriesForFile(absolutePath)
		await fs.writeFile(absolutePath, content, "utf-8")

		// Open the document to ensure diagnostics are loaded
		// When openFile is false (PREVENT_FOCUS_DISRUPTION enabled), we only open in memory
		if (openFile) {
			// Show the document in the editor
			await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
				preview: false,
				preserveFocus: true,
			})
		} else {
			// Just open the document in memory to trigger diagnostics without showing it
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath))

			// Save the document to ensure VSCode recognizes it as saved and triggers diagnostics
			if (doc.isDirty) {
				await doc.save()
			}

			// Force a small delay to ensure diagnostics are triggered
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		const newProblemsMessage = await this.diagnostics.collectPostSaveDiagnostics(
			preDiagnostics,
			diagnosticsEnabled,
			writeDelayMs,
		)

		// Store the results for pushToolWriteResult
		this.newProblemsMessage = newProblemsMessage
		this.userEdits = undefined
		this.lastEditedRelPath = relPath
		// preventFocusDisruption path doesn't populate pendingSave, but a
		// stale buffer from a prior diff-editor session must not survive a
		// switch to direct mode.
		this.pendingSave = undefined

		return {
			newProblemsMessage,
			userEdits: undefined,
			finalContent: content,
		}
	}
}
