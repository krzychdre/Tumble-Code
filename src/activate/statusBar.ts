import * as vscode from "vscode"

import { Package } from "../shared/package"
import { getCommand } from "../utils/commands"
import { t } from "../i18n"

/**
 * The argument the status bar item passes to `openInNewTab`. The command then
 * reports the click as coming from the status bar; the Tumble tab's title bar
 * and the command palette do not pass it, and their runs are not reported.
 */
export const STATUS_BAR_CLICK_SOURCE = "statusBar"

/**
 * Adds a "Tumble Code" entry at the right end of the status bar. A click opens
 * a new Tumble editor tab, also when another one is already open (beside the
 * Tumble tab used last), like "Open In New Tab" in a Tumble tab's title bar.
 * The Tumble button in a file editor's title bar instead shows the open tab;
 * it exists only while a file editor is open, this entry is always there, also
 * in an empty window.
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
		command: getCommand("openInNewTab"),
		arguments: [STATUS_BAR_CLICK_SOURCE],
	}
	item.show()
	context.subscriptions.push(item)
	return item
}
