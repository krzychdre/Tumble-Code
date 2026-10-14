import * as vscode from "vscode"

import { Package } from "../shared/package"
import { getCommand } from "../utils/commands"
import { t } from "../i18n"

/**
 * The argument the status bar item passes to `editorTitleButtonClicked`. The
 * command then reports the click as coming from the status bar; the editor
 * title menu passes the editor's URI instead, and the command palette passes
 * nothing.
 */
export const STATUS_BAR_CLICK_SOURCE = "statusBar"

/**
 * Adds a "Tumble Code" entry at the right end of the status bar. A click shows
 * the Tumble editor tab, or opens one, exactly like the button in the editor
 * title bar. That button exists only while a file editor is open; this entry is
 * always there, also in an empty window.
 *
 * The item has a stable id and a name, so VS Code lists it in the status bar's
 * context menu and the user can hide it there.
 */
export function registerStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(`${Package.name}.openTab`, vscode.StatusBarAlignment.Right, 100)
	item.name = "Tumble Code"
	item.text = "$(sparkle) Tumble Code"
	item.tooltip = t("common:statusBar.openTab")
	item.command = {
		title: item.tooltip,
		command: getCommand("editorTitleButtonClicked"),
		arguments: [STATUS_BAR_CLICK_SOURCE],
	}
	item.show()
	context.subscriptions.push(item)
	return item
}
