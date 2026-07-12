import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as diff from "diff"

import { arePathsEqual } from "../../utils/path"

import { stripAllBOMs } from "./stripAllBOMs"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"
export const DIFF_VIEW_LABEL_CHANGES = "Original ↔ Roo's Changes"

// VS Code refreshes Tab.isDirty asynchronously after a save, so tabGroups.close()
// can be refused for a turn or two of the event loop. Bounds the close retry in
// closeDiffTab() so a tab that genuinely cannot close never loops forever.
const CLOSE_DIFF_TAB_MAX_ATTEMPTS = 5

/**
 * Owns the VS Code diff-editor lifecycle: opening the diff editor, scrolling /
 * revealing, and querying / closing diff tabs. Extracted from DiffViewProvider
 * so the tab and editor interactions are unit-testable without a full provider.
 */
export class DiffEditorLifecycleManager {
	private cwd: string

	constructor(cwd: string) {
		this.cwd = cwd
	}

	/**
	 * Close any existing file tabs matching `absolutePath` (used by the
	 * provider's `open()` to avoid duplicate tabs before opening the diff view).
	 * Returns whether at least one tab was open.
	 */
	async closeFileTabs(absolutePath: string): Promise<boolean> {
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputText &&
					tab.input.uri.scheme === "file" &&
					arePathsEqual(tab.input.uri.fsPath, absolutePath),
			)

		let documentWasOpen = false
		for (const tab of tabs) {
			if (!tab.isDirty) {
				try {
					await vscode.window.tabGroups.close(tab)
				} catch (err) {
					console.error(`Failed to close tab ${tab.label}`, err)
				}
			}
			documentWasOpen = true
		}
		return documentWasOpen
	}

	/**
	 * Open the diff editor for `relPath`. `editType` decides the diff label
	 * ("New File" vs "Changes"); `originalContent` becomes the original side
	 * of the diff (base64 in the cline-diff URI query string).
	 */
	async openDiffEditor(
		relPath: string,
		editType: "create" | "modify" | undefined,
		originalContent: string | undefined,
	): Promise<vscode.TextEditor> {
		const uri = vscode.Uri.file(path.resolve(this.cwd, relPath))

		// If this diff editor is already open (ie if a previous write file was
		// interrupted) then we should activate that instead of opening a new
		// diff.
		const diffTab = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME &&
					arePathsEqual(tab.input.modified.fsPath, uri.fsPath),
			)

		if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
			const editor = await vscode.window.showTextDocument(diffTab.input.modified, { preserveFocus: true })
			return editor
		}

		// Open new diff editor.
		return new Promise<vscode.TextEditor>((resolve, reject) => {
			const fileName = path.basename(uri.fsPath)
			const fileExists = editType === "modify"
			const DIFF_EDITOR_TIMEOUT = 10_000 // ms

			let timeoutId: NodeJS.Timeout | undefined
			const disposables: vscode.Disposable[] = []

			const cleanup = () => {
				if (timeoutId) {
					clearTimeout(timeoutId)
					timeoutId = undefined
				}
				disposables.forEach((d) => d.dispose())
				disposables.length = 0
			}

			// Set timeout for the entire operation
			timeoutId = setTimeout(() => {
				cleanup()
				reject(
					new Error(
						`Failed to open diff editor for ${uri.fsPath} within ${DIFF_EDITOR_TIMEOUT / 1000} seconds. The editor may be blocked or VS Code may be unresponsive.`,
					),
				)
			}, DIFF_EDITOR_TIMEOUT)

			// Listen for document open events - more efficient than scanning all tabs
			disposables.push(
				vscode.workspace.onDidOpenTextDocument(async (document) => {
					// Only match file:// scheme documents to avoid git diffs
					if (document.uri.scheme === "file" && arePathsEqual(document.uri.fsPath, uri.fsPath)) {
						// Wait a tick for the editor to be available
						await new Promise((r) => setTimeout(r, 0))

						// Find the editor for this document
						const editor = vscode.window.visibleTextEditors.find(
							(e) => e.document.uri.scheme === "file" && arePathsEqual(e.document.uri.fsPath, uri.fsPath),
						)

						if (editor) {
							cleanup()
							resolve(editor)
						}
					}
				}),
			)

			// Also listen for visible editor changes as a fallback
			disposables.push(
				vscode.window.onDidChangeVisibleTextEditors((editors) => {
					const editor = editors.find((e) => {
						const isFileScheme = e.document.uri.scheme === "file"
						const pathMatches = arePathsEqual(e.document.uri.fsPath, uri.fsPath)
						return isFileScheme && pathMatches
					})
					if (editor) {
						cleanup()
						resolve(editor)
					}
				}),
			)

			// Pre-open the file as a text document to ensure it doesn't open in preview mode
			// This fixes issues with files that have custom editor associations (like markdown preview)
			vscode.window
				.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Active, preserveFocus: true })
				.then(() => {
					// Execute the diff command after ensuring the file is open as text
					return vscode.commands.executeCommand(
						"vscode.diff",
						vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
							query: Buffer.from(originalContent ?? "").toString("base64"),
						}),
						uri,
						`${fileName}: ${fileExists ? `${DIFF_VIEW_LABEL_CHANGES}` : "New File"} (Editable)`,
						{ preserveFocus: true },
					)
				})
				.then(
					() => {
						// Command executed successfully, now wait for the editor to appear
					},
					(err: any) => {
						cleanup()
						reject(new Error(`Failed to execute diff command for ${uri.fsPath}: ${err.message}`))
					},
				)
		})
	}

	scrollEditorToLine(editor: vscode.TextEditor, line: number) {
		const scrollLine = line + 4

		editor.revealRange(new vscode.Range(scrollLine, 0, scrollLine, 0), vscode.TextEditorRevealType.InCenter)
	}

	scrollToFirstDiff(editor: vscode.TextEditor, originalContent: string | undefined) {
		const currentContent = editor.document.getText()
		const diffs = diff.diffLines(originalContent || "", currentContent)

		let lineCount = 0

		for (const part of diffs) {
			if (part.added || part.removed) {
				// Found the first diff, scroll to it without stealing focus.
				editor.revealRange(new vscode.Range(lineCount, 0, lineCount, 0), vscode.TextEditorRevealType.InCenter)

				return
			}

			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	/**
	 * True if `tab` is one of Roo's own diff-edit tabs. Mirrors the two
	 * recognition strategies the close logic has always used: the `cline-diff`
	 * URI scheme on the original side, and the diff-view label as a fallback for
	 * pre-opened files whose original side ends up with a `file` scheme instead.
	 *
	 * Deliberately ignores `tab.isDirty` — identifying the tab and deciding
	 * whether it is safe to close are two separate concerns.
	 */
	private isRooDiffTab(tab: vscode.Tab): boolean {
		if (tab.input instanceof vscode.TabInputTextDiff && tab.input.original.scheme === DIFF_VIEW_URI_SCHEME) {
			return true
		}

		return tab.label.includes(DIFF_VIEW_LABEL_CHANGES)
	}

	/**
	 * Closes a single Roo diff tab.
	 *
	 * A diff tab's modified side is the real file document; the streamed
	 * `applyEdit` calls in `update()` leave that document dirty. By the time a
	 * diff session is being closed the approved bytes are already on disk
	 * (`saveChanges()` / `flushPendingSaveDirectly()` ran first), so disk is
	 * authoritative. Two things otherwise leave the tab orphaned — open, still
	 * carrying VS Code's unsaved marker, showing stale content:
	 *
	 *   1. A recovery-path `fs.writeFile` persists the bytes behind VS Code's
	 *      back, so the in-memory buffer still looks dirty. We revert it to the
	 *      on-disk content (idempotent — disk already holds the correct bytes)
	 *      and save, which clears the document's dirty flag.
	 *   2. VS Code refreshes `Tab.isDirty` asynchronously: after a save the tab
	 *      can still report dirty for a turn of the event loop, and
	 *      `tabGroups.close()` refuses (resolves `false`) a tab it believes is
	 *      dirty. The earlier fix closed exactly once and trusted it — so a
	 *      close issued in that lag window was silently dropped. We now retry a
	 *      refused close against a freshly-read tab, yielding between attempts
	 *      so the dirty flag can propagate.
	 */
	private async closeDiffTab(tab: vscode.Tab): Promise<void> {
		try {
			const modifiedPath = tab.input instanceof vscode.TabInputTextDiff ? tab.input.modified.fsPath : undefined

			if (modifiedPath) {
				const document = vscode.workspace.textDocuments.find(
					(doc) => doc.uri.scheme === "file" && arePathsEqual(doc.uri.fsPath, modifiedPath),
				)

				if (document && document.isDirty) {
					// Revert the in-memory buffer to whatever is on disk. The disk
					// content is authoritative here — saveChanges() or the direct
					// recovery write already persisted the approved bytes; an
					// fs.writeFile in particular does not notify VS Code, so the
					// buffer can still look dirty even though disk is correct.
					const onDiskContent = await fs.readFile(modifiedPath, "utf-8")
					const revertEdit = new vscode.WorkspaceEdit()
					const fullRange = new vscode.Range(
						document.positionAt(0),
						document.positionAt(document.getText().length),
					)
					revertEdit.replace(document.uri, fullRange, stripAllBOMs(onDiskContent))
					await vscode.workspace.applyEdit(revertEdit)
					await document.save()
				}
			}

			// `tabGroups.close()` returns a Thenable<boolean>: a falsy result
			// means VS Code refused the close — typically because it still
			// believes the tab is dirty (its `Tab.isDirty` refresh lags the
			// document save). Retry against a freshly-read tab, yielding a turn
			// of the event loop between attempts so the flag can settle. A `true`
			// result is trusted immediately.
			let target: vscode.Tab | undefined = tab
			for (let attempt = 0; attempt < CLOSE_DIFF_TAB_MAX_ATTEMPTS; attempt++) {
				const closed = await vscode.window.tabGroups.close(target)
				target = this.findOpenTab(tab)

				if (closed || !target) {
					return
				}

				// Let VS Code propagate the post-save Tab.isDirty refresh.
				await new Promise((resolve) => setTimeout(resolve, 0))
			}

			console.error(`Failed to close diff tab ${tab.label} after ${CLOSE_DIFF_TAB_MAX_ATTEMPTS} attempts`)
		} catch (err) {
			console.error(`Failed to close diff tab ${tab.label}`, err)
		}
	}

	/**
	 * Re-locates a still-open tab equivalent to `tab` in the current tab model.
	 * VS Code can hand back a fresh `Tab` object after state changes, so the
	 * original reference may be stale — match by identity first, then by the
	 * diff tab's modified-side path. Returns undefined once the tab is gone.
	 */
	private findOpenTab(tab: vscode.Tab): vscode.Tab | undefined {
		const modifiedPath = tab.input instanceof vscode.TabInputTextDiff ? tab.input.modified.fsPath : undefined

		return vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find((candidate) => {
				if (candidate === tab) {
					return true
				}
				return (
					modifiedPath !== undefined &&
					candidate.input instanceof vscode.TabInputTextDiff &&
					arePathsEqual(candidate.input.modified.fsPath, modifiedPath)
				)
			})
	}

	async closeAllDiffViews(): Promise<void> {
		const diffTabs = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.filter((tab) => this.isRooDiffTab(tab))

		await Promise.all(diffTabs.map((tab) => this.closeDiffTab(tab)))
	}
}
