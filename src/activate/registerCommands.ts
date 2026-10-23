import * as vscode from "vscode"
import delay from "delay"

import type { CommandId } from "@tumble-code/types"
import { TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { Package } from "../shared/package"
import { getCommand } from "../utils/commands"
import { ClineProvider } from "../core/webview/ClineProvider"
import { panelRegistry } from "../core/webview/panelRegistry"
import { ContextProxy } from "../core/config/ContextProxy"
import { focusPanel } from "../utils/focusPanel"
import { handleNewTask } from "./handleTask"
import { STATUS_BAR_CLICK_SOURCE } from "./statusBar"
import { CodeIndexManager } from "../services/code-index/manager"
import { importSettingsWithFeedback } from "../core/config/importExport"
import { registerRipgrepDiagnosticCommand } from "../services/ripgrep/diagnostic"
import { t } from "../i18n"
import { logger } from "../utils/logging"

/**
 * Helper to get the visible ClineProvider instance or log if not found.
 */
export function getVisibleProviderOrLog(): ClineProvider | undefined {
	const visibleProvider = panelRegistry.getVisibleInstance()
	if (!visibleProvider) {
		logger.warn("Cannot find any visible Tumble Code instances.")
		return undefined
	}
	return visibleProvider
}

export type RegisterCommandOptions = {
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
	provider: ClineProvider
}

export const registerCommands = (options: RegisterCommandOptions) => {
	const { context } = options

	for (const [id, callback] of Object.entries(getCommandsMap(options))) {
		const command = getCommand(id as CommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}

	context.subscriptions.push(registerRipgrepDiagnosticCommand())
}

// `showRipgrepDiagnostic` is registered separately by
// `registerRipgrepDiagnosticCommand` (above), which owns the OutputChannel
// lifecycle alongside the command registration, so it's intentionally
// excluded from this map.
//
// Callback shape mirrors VS Code's own `commands.registerCommand` signature
// (`(...args: any[]) => any`), with the return narrowed to `unknown` so
// callers must inspect before using. `any[]` for args is unavoidable: the
// callbacks here are heterogeneous (`importSettings` takes an optional
// `filePath?: string`, others take none) and VS Code dispatches positional
// args dynamically.
type CommandCallback = (...args: any[]) => unknown
const getCommandsMap = ({
	context,
	outputChannel,
	provider,
}: RegisterCommandOptions): Record<Exclude<CommandId, "showRipgrepDiagnostic">, CommandCallback> => ({
	activationCompleted: () => {},
	cloudButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog()

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, { button: "cloud" })

		visibleProvider.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
	},
	plusButtonClicked: async () => {
		const visibleProvider = getVisibleProviderOrLog()

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, { button: "plus" })

		await visibleProvider.leaveCurrentTask()
		await visibleProvider.refreshWorkspace()
		await visibleProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		// Send focusInput action immediately after chatButtonClicked
		// This ensures the focus happens after the view has switched
		await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
	},
	popoutButtonClicked: () => {
		TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, { button: "popout" })

		return openClineInNewTab({ context, outputChannel })
	},
	// The button in the title bar of every file editor: shows the Tumble tab
	// used last, or opens one. Alt+click runs openInNewTab instead.
	editorTitleButtonClicked: async () => {
		TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, { button: "editorTitle" })

		const tab = panelRegistry.getEditorTab()
		if (tab) {
			tab.reveal()
			return
		}
		await openClineInNewTab({ context, outputChannel })
	},
	// Always opens another Tumble tab. Run by "Open In New Tab" in a Tumble
	// tab's title bar, Alt+click on the editor title button, the command
	// palette, and the status bar item (`./statusBar`), which passes
	// STATUS_BAR_CLICK_SOURCE so that only its clicks are reported.
	openInNewTab: (source?: unknown) => {
		if (source === STATUS_BAR_CLICK_SOURCE) {
			TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, {
				button: STATUS_BAR_CLICK_SOURCE,
			})
		}

		return openClineInNewTab({ context, outputChannel })
	},
	settingsButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog()

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, { button: "settings" })

		visibleProvider.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })
		// Also explicitly post the visibility message to trigger scroll reliably
		visibleProvider.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
	},
	historyButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog()

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, { button: "history" })

		visibleProvider.postMessageToWebview({ type: "action", action: "historyButtonClicked" })
	},
	marketplaceButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog()
		if (!visibleProvider) return
		visibleProvider.postMessageToWebview({ type: "action", action: "marketplaceButtonClicked" })
	},
	newTask: handleNewTask,
	setCustomStoragePath: async () => {
		const { promptForCustomStoragePath } = await import("../utils/storage")
		await promptForCustomStoragePath()
	},
	importSettings: async (filePath?: string) => {
		const visibleProvider = getVisibleProviderOrLog()
		if (!visibleProvider) {
			return
		}

		await importSettingsWithFeedback(
			{
				providerSettingsManager: visibleProvider.providerSettingsManager,
				contextProxy: visibleProvider.contextProxy,
				customModesManager: visibleProvider.customModesManager,
				provider: visibleProvider,
			},
			filePath,
		)
	},
	focusInput: async () => {
		try {
			const host = panelRegistry.getLastActiveInstance()
			await focusPanel(host)

			// Send focus input message only for the sidebar (`provider`); a
			// tab focuses its input itself when it comes into view.
			if (host === provider) {
				provider.postMessageToWebview({ type: "action", action: "focusInput" })
			}
		} catch (error) {
			logger.error(`Error focusing input: ${error}`)
		}
	},
	focusPanel: async () => {
		try {
			await focusPanel(panelRegistry.getLastActiveInstance())
		} catch (error) {
			logger.error(`Error focusing panel: ${error}`)
		}
	},
	acceptInput: () => {
		const visibleProvider = getVisibleProviderOrLog()

		if (!visibleProvider) {
			return
		}

		visibleProvider.postMessageToWebview({ type: "acceptInput" })
	},
	toggleAutoApprove: async () => {
		const visibleProvider = getVisibleProviderOrLog()

		if (!visibleProvider) {
			return
		}

		visibleProvider.postMessageToWebview({
			type: "action",
			action: "toggleAutoApprove",
		})
	},
	pickUpAgentSession: async () => {
		const { pickUpAgentSession } = await import("../core/agent-interchange")
		await pickUpAgentSession(context)
	},
	handOffCurrentTask: async () => {
		const { handOffCurrentTask } = await import("../core/agent-interchange")
		await handOffCurrentTask(context)
	},
	reviewPlanFile: async (uri?: vscode.Uri) => {
		let fileUri = uri
		if (!fileUri) {
			const editor = vscode.window.activeTextEditor
			if (editor) {
				fileUri = editor.document.uri
			}
		}
		if (!fileUri) {
			vscode.window.showWarningMessage("No file is currently open to review.")
			return
		}
		if (fileUri.scheme !== "file" || !fileUri.fsPath.toLowerCase().endsWith(".md")) {
			vscode.window.showWarningMessage("Review Plan is only available for Markdown files.")
			return
		}
		const { PlanReviewPanel } = await import("../core/webview/PlanReviewPanel")
		await PlanReviewPanel.open(context, { filePath: fileUri.fsPath })
	},
})

/**
 * Replaces editor tabs left behind by a previous extension host. A tab
 * outlives a restarted host (installing a VSIX and clicking "Restart
 * Extensions" does that): it keeps showing the old page, but its messages
 * reach no provider, so history rows, "View all" and every other round trip do
 * nothing. The old host cannot close it, by the time `deactivate` runs its
 * messages no longer reach the window, and a panel serializer only revives
 * tabs restored with a window. So the new host closes those tabs and opens a
 * working one for each, in the same group. Call it before this host opens a
 * tab of its own.
 */
export const replaceOrphanedTabs = async (options: Omit<RegisterCommandOptions, "provider">) => {
	const orphans = vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.filter(
			(tab) =>
				tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(ClineProvider.tabPanelId),
		)
	if (orphans.length === 0) {
		return
	}
	// The old tabs' groups are locked, so they stay open, empty; reuse them.
	const viewColumns = orphans.map((orphan) => orphan.group.viewColumn)
	await vscode.window.tabGroups.close(orphans)
	for (const viewColumn of viewColumns) {
		await openClineInNewTab(options, viewColumn)
	}
}

/**
 * Opens Tumble Code in a new editor tab: in `viewColumn` if given, else next
 * to the Tumble tab used last (in its locked group), else right of the open
 * editors.
 */
export const openClineInNewTab = async (
	{ context, outputChannel }: Omit<RegisterCommandOptions, "provider">,
	viewColumn?: vscode.ViewColumn,
) => {
	// (This example uses webviewProvider activation event which is necessary to
	// deserialize cached webview, but since we use retainContextWhenHidden, we
	// don't need to use that event).
	// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	const contextProxy = await ContextProxy.getInstance(context)
	const codeIndexManager = CodeIndexManager.getInstance(context)

	// Another Tumble tab is open: open the new one beside it, in its group.
	// Without this, with no text editor visible, a second tab went through
	// newGroupRight (a new group right of the active one) and then into
	// column two: with the first Tumble tab in column two, that is its own
	// group, and the new group stayed empty.
	viewColumn ??= panelRegistry.getEditorTab()?.viewColumn

	const tabProvider = new ClineProvider(context, outputChannel, "editor", contextProxy)
	const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

	// Check if there are any visible text editors, otherwise open a new group
	// to the right.
	const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

	if (viewColumn === undefined && !hasVisibleEditors) {
		await vscode.commands.executeCommand("workbench.action.newGroupRight")
	}

	const targetCol = viewColumn ?? (hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two)

	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Tumble Code", targetCol, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [context.extensionUri],
	})

	// TODO: Use better svg icon with light and dark variants (see
	// https://stackoverflow.com/questions/58365687/vscode-extension-iconpath).
	newPanel.iconPath = {
		light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_light.png"),
		dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "panel_dark.png"),
	}

	// resolveWebviewView also sends didBecomeVisible when the panel comes back
	// on screen; a second listener here would fire on every focus change.
	// It also disposes the provider when the tab is closed.
	await tabProvider.resolveWebviewView(newPanel)

	// Lock the editor group so clicking on files doesn't open them over the panel.
	await delay(100)
	await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

	return tabProvider
}
