import * as path from "path"
import * as fs from "fs/promises"
import * as vscode from "vscode"

import { type Language, type WebviewMessage } from "@roo-code/types"

import { Package } from "../../shared/package"
import { formatLanguage } from "../../shared/language"
import { getHmrHtml, getProductionHtml, type WebviewHtmlOptions } from "./WebviewHtml"
import { ClineProvider } from "./ClineProvider"
import { registerPlanReviewFile, unregisterPlanReviewFile } from "./planReviewRegistry"
import { arePathsEqual } from "../../utils/path"

interface PlanReviewTarget {
	filePath?: string
	markdown?: string
}

interface PanelEntry {
	panel: vscode.WebviewPanel
	filePath?: string
	watcher?: vscode.FileSystemWatcher
	disposed: boolean
	/** Compiled draft annotations, kept in sync by the webview so Approve on a
	 * pending review ask can send them without a round trip. */
	draftNotes?: string
	/** Latest markdown pushed to the webview — becomes the diff baseline for
	 * the next review round when the panel closes. */
	currentMarkdown?: string
}

/**
 * Manages a dedicated editor-area WebviewPanel that renders a plan file (or raw
 * markdown) and routes annotations back into the active task.
 *
 * File mode: one panel per file path (reused if re-opened). A FileSystemWatcher
 * pushes live updates when the file changes on disk.
 * Content mode: a single shared panel (re-initialized on each open).
 */
export class PlanReviewPanel {
	private static panels = new Map<string, PanelEntry>()
	private static contentPanel: PanelEntry | null = null
	/** Per-file markdown as of the last closed review — the baseline the next
	 * review round diffs against so the user sees what the model changed. */
	private static lastReviewedContent = new Map<string, string>()

	/** The plan review panel's differences from the other webviews; see {@link getProductionHtml}. */
	private static htmlOptions(webview: vscode.Webview, extensionUri: vscode.Uri): WebviewHtmlOptions {
		return { webview, extensionUri, title: "Plan Review", planReviewMode: true }
	}

	private static isDevMode(): boolean {
		return process.env.NODE_ENV === "development" || !!process.env.VITE_PORT
	}

	private static getLanguage(): Language {
		return formatLanguage(vscode.env.language)
	}

	private static async resolveMarkdown(target: PlanReviewTarget): Promise<string> {
		if (target.filePath) {
			try {
				return await fs.readFile(target.filePath, "utf8")
			} catch {
				vscode.window.showErrorMessage(`Failed to read plan file: ${target.filePath}`)
				return ""
			}
		}
		return target.markdown ?? ""
	}

	private static findEntry(panel: vscode.WebviewPanel): PanelEntry | undefined {
		for (const entry of this.panels.values()) {
			if (entry.panel === panel) {
				return entry
			}
		}
		return this.contentPanel?.panel === panel ? this.contentPanel : undefined
	}

	/**
	 * Returns and clears the draft annotation notes for a file, notifying the
	 * panel so its UI clears too. Used when the user resolves the pending
	 * review ask with Approve while draft notes exist — the notes are the
	 * review response.
	 */
	static consumeDraftNotes(fsPath: string): string | undefined {
		for (const [key, entry] of this.panels) {
			if (!entry.disposed && entry.draftNotes && arePathsEqual(key, fsPath)) {
				const notes = entry.draftNotes
				entry.draftNotes = undefined
				entry.panel.webview.postMessage({ type: "planReviewDraftsConsumed" })
				return notes
			}
		}
		return undefined
	}

	private static setupMessageListener(panel: vscode.WebviewPanel, target: PlanReviewTarget): void {
		panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			switch (message.type) {
				case "planReviewDraftsChanged": {
					const entry = this.findEntry(panel)
					if (entry) {
						const count = (message.values?.count as number | undefined) ?? 0
						entry.draftNotes = count > 0 && message.text ? message.text : undefined
					}
					break
				}
				case "planReviewReady": {
					const markdown = await this.resolveMarkdown(target)
					const entry = this.findEntry(panel)
					if (entry) {
						entry.currentMarkdown = markdown
					}
					panel.webview.postMessage({
						type: "planReviewInit",
						planReview: {
							filePath: target.filePath,
							markdown,
							baselineMarkdown: target.filePath
								? this.lastReviewedContent.get(target.filePath)
								: undefined,
							language: this.getLanguage(),
						},
					})
					break
				}
				case "planReviewSubmit": {
					// Sending notes resolves this review round — close the
					// panel. The next round's pause re-opens it on the revised
					// plan with the changes highlighted.
					await this.handleSubmit(message.text)
					panel.dispose()
					break
				}
				case "planReviewClose": {
					panel.dispose()
					break
				}
			}
		})
	}

	private static async handleSubmit(text: string | undefined): Promise<void> {
		if (!text) return

		// getInstance() focuses the sidebar if it isn't visible (the user is
		// typically focused on this editor panel when submitting).
		const provider = await ClineProvider.getInstance()
		const task = provider?.getCurrentTask()

		if (task) {
			await task.submitUserMessage(text)
		} else if (provider) {
			await provider.createTask(text)
		} else {
			vscode.window.showErrorMessage("No active Tumble Code task. Open the sidebar and try again.")
			return
		}

		// Focus the sidebar the same way api.ts does.
		try {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		} catch {
			// Sidebar focus is best-effort.
		}
	}

	private static setupWatcher(entry: PanelEntry, filePath: string): vscode.FileSystemWatcher | undefined {
		const dir = path.dirname(filePath)
		const base = path.basename(filePath)
		const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), base)
		const watcher = vscode.workspace.createFileSystemWatcher(pattern)

		watcher.onDidChange(async () => {
			try {
				const markdown = await fs.readFile(filePath, "utf8")
				entry.currentMarkdown = markdown
				entry.panel.webview.postMessage({
					type: "planReviewUpdate",
					planReview: { markdown },
				})
			} catch {
				// File may be temporarily unavailable; skip silently.
			}
		})

		return watcher
	}

	private static disposeEntry(entry: PanelEntry): void {
		entry.disposed = true
		entry.watcher?.dispose()
		if (entry.filePath) {
			// The content the user last saw becomes the baseline the next
			// review round diffs against.
			if (entry.currentMarkdown !== undefined) {
				this.lastReviewedContent.set(entry.filePath, entry.currentMarkdown)
			}
			unregisterPlanReviewFile(entry.filePath)
			this.panels.delete(entry.filePath)
		}
		if (this.contentPanel === entry) {
			this.contentPanel = null
		}
	}

	/**
	 * Seeds the diff baseline for a file's FIRST review round from its
	 * pre-write content, so "what did the model just change" is highlighted
	 * even before any review has closed. Later rounds keep the
	 * content-at-last-close baseline (never overwritten here).
	 */
	static seedBaseline(fsPath: string, preWriteContent: string | undefined): void {
		if (preWriteContent && !this.lastReviewedContent.has(fsPath)) {
			this.lastReviewedContent.set(fsPath, preWriteContent)
		}
	}

	/**
	 * Closes the review panel for a file after its review round resolved
	 * (Approve/Deny on the pending ask). No-op when no panel is open.
	 */
	static closeForFile(fsPath: string): void {
		for (const [key, entry] of this.panels) {
			if (!entry.disposed && arePathsEqual(key, fsPath)) {
				entry.panel.dispose()
				return
			}
		}
	}

	/**
	 * Opens (or reveals) a plan review panel.
	 * - File mode: one panel per file path; re-opening the same file reveals the existing panel.
	 * - Content mode: a single shared panel; re-opening re-initializes it.
	 */
	static async open(context: vscode.ExtensionContext, target: PlanReviewTarget): Promise<void> {
		const isDev = this.isDevMode()

		// File mode: check for existing panel.
		if (target.filePath) {
			const existing = this.panels.get(target.filePath)
			if (existing && !existing.disposed) {
				existing.panel.reveal(vscode.ViewColumn.Active)
				// Re-init in case the file changed since last open.
				const markdown = await this.resolveMarkdown(target)
				existing.currentMarkdown = markdown
				existing.panel.webview.postMessage({
					type: "planReviewInit",
					planReview: {
						filePath: target.filePath,
						markdown,
						baselineMarkdown: this.lastReviewedContent.get(target.filePath),
						language: this.getLanguage(),
					},
				})
				return
			}
		} else {
			// Content mode: reuse the single content panel.
			if (this.contentPanel && !this.contentPanel.disposed) {
				this.contentPanel.panel.reveal(vscode.ViewColumn.Active)
				this.contentPanel.panel.webview.postMessage({
					type: "planReviewInit",
					planReview: {
						filePath: undefined,
						markdown: target.markdown ?? "",
						language: this.getLanguage(),
					},
				})
				return
			}
		}

		const title = target.filePath ? `Plan Review: ${path.basename(target.filePath)}` : "Plan Review"

		const panel = vscode.window.createWebviewPanel("tumble-code.planReview", title, vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		})

		const htmlOptions = this.htmlOptions(panel.webview, context.extensionUri)
		panel.webview.html = isDev ? await getHmrHtml(htmlOptions) : getProductionHtml(htmlOptions)

		this.setupMessageListener(panel, target)

		const entry: PanelEntry = { panel, filePath: target.filePath, disposed: false }
		if (target.filePath) {
			entry.watcher = this.setupWatcher(entry, target.filePath)
			registerPlanReviewFile(target.filePath)
			this.panels.set(target.filePath, entry)
		} else {
			this.contentPanel = entry
		}

		panel.onDidDispose(() => {
			this.disposeEntry(entry)
		})
	}
}
