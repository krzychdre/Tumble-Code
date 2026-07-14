import * as path from "path"
import * as fs from "fs/promises"
import * as vscode from "vscode"

import { type Language, type WebviewMessage } from "@roo-code/types"

import { Package } from "../../shared/package"
import { formatLanguage } from "../../shared/language"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
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

	private static async getHtmlContent(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
		const stylesUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const scriptUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const codiconsUri = getUri(webview, extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, extensionUri, ["assets", "vscode-material-icons", "icons"])
		const imagesUri = getUri(webview, extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, extensionUri, ["webview-ui", "audio"])

		const nonce = getNonce()

		return /*html*/ `
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'; connect-src ${webview.cspSource} https://api.requesty.ai;">
				<link rel="stylesheet" type="text/css" href="${stylesUri}">
				<link href="${codiconsUri}" rel="stylesheet" />
				<script nonce="${nonce}">
					window.IMAGES_BASE_URI = "${imagesUri}"
					window.AUDIO_BASE_URI = "${audioUri}"
					window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
					window.PLAN_REVIEW_MODE = true
				</script>
				<title>Plan Review</title>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
			</body>
		</html>
		`
	}

	private static async getHMRHtmlContent(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
		let localPort = "5173"

		try {
			const fs = require("fs")
			const pathMod = require("path")
			const portFilePath = pathMod.resolve(__dirname, "../../.vite-port")

			if (fs.existsSync(portFilePath)) {
				localPort = fs.readFileSync(portFilePath, "utf8").trim()
			}
		} catch {
			// Port file not found, use default
		}

		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running; fall back to prod if not.
		try {
			const axios = require("axios")
			await axios.get(`http://${localServerUrl}`)
		} catch {
			return this.getHtmlContent(webview, extensionUri)
		}

		const nonce = getNonce()

		const stylesUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const codiconsUri = getUri(webview, extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, extensionUri, ["assets", "vscode-material-icons", "icons"])
		const imagesUri = getUri(webview, extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, extensionUri, ["webview-ui", "audio"])

		const file = "src/index.tsx"
		const scriptUri = `http://${localServerUrl}/${file}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:`,
			`media-src ${webview.cspSource}`,
			`script-src 'unsafe-eval' ${webview.cspSource} https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource} https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
						window.PLAN_REVIEW_MODE = true
					</script>
					<title>Plan Review</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
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
					panel.webview.postMessage({
						type: "planReviewInit",
						planReview: {
							filePath: target.filePath,
							markdown,
							language: this.getLanguage(),
						},
					})
					break
				}
				case "planReviewSubmit": {
					// The panel stays open: the model's revision of the plan
					// live-updates the view (file watcher), and while the file
					// is open here its edits require approval — that is the
					// annotate → revise → re-review loop.
					await this.handleSubmit(message.text)
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

	private static setupWatcher(panel: vscode.WebviewPanel, filePath: string): vscode.FileSystemWatcher | undefined {
		const dir = path.dirname(filePath)
		const base = path.basename(filePath)
		const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), base)
		const watcher = vscode.workspace.createFileSystemWatcher(pattern)

		watcher.onDidChange(async () => {
			try {
				const markdown = await fs.readFile(filePath, "utf8")
				panel.webview.postMessage({
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
			unregisterPlanReviewFile(entry.filePath)
			this.panels.delete(entry.filePath)
		}
		if (this.contentPanel === entry) {
			this.contentPanel = null
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
				existing.panel.webview.postMessage({
					type: "planReviewInit",
					planReview: {
						filePath: target.filePath,
						markdown,
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

		panel.webview.html = isDev
			? await this.getHMRHtmlContent(panel.webview, context.extensionUri)
			: await this.getHtmlContent(panel.webview, context.extensionUri)

		this.setupMessageListener(panel, target)

		let watcher: vscode.FileSystemWatcher | undefined
		if (target.filePath) {
			watcher = this.setupWatcher(panel, target.filePath)
		}

		const entry: PanelEntry = { panel, filePath: target.filePath, watcher, disposed: false }
		if (target.filePath) {
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
