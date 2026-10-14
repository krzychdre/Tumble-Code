import * as vscode from "vscode"
import { Package } from "../shared/package"
import type { ClineProvider } from "../core/webview/ClineProvider"

/**
 * Focuses the Tumble Code panel the user was in last (`host`, the sidebar or
 * one of the editor tabs), or opens the sidebar when no panel is open.
 */
export async function focusPanel(host: ClineProvider | undefined): Promise<void> {
	if (host) {
		await host.revealView()
	} else {
		await vscode.commands.executeCommand(`workbench.view.extension.${Package.name}-ActivityBar`)
	}
}
