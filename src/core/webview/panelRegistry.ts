import type * as vscode from "vscode"

/**
 * The webview panel Tumble Code is currently shown in: either the sidebar view
 * or an editor tab, never both.
 *
 * ClineProvider records the panel it resolves into, and the commands in
 * activate/registerCommands read it (focus, focus input). The references live
 * here rather than in registerCommands so ClineProvider does not import
 * src/activate, which itself constructs ClineProvider.
 */
let sidebarPanel: vscode.WebviewView | undefined = undefined
let tabPanel: vscode.WebviewPanel | undefined = undefined

/** The active panel: the tab if one is open, otherwise the sidebar view. */
export function getPanel(): vscode.WebviewPanel | vscode.WebviewView | undefined {
	return tabPanel || sidebarPanel
}

export function getTabPanel(): vscode.WebviewPanel | undefined {
	return tabPanel
}

export function getSidebarPanel(): vscode.WebviewView | undefined {
	return sidebarPanel
}

/** Records the panel of the given kind and forgets the other kind. */
export function setPanel(
	newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
	type: "sidebar" | "tab",
): void {
	if (type === "sidebar") {
		sidebarPanel = newPanel as vscode.WebviewView
		tabPanel = undefined
	} else {
		tabPanel = newPanel as vscode.WebviewPanel
		sidebarPanel = undefined
	}
}

/** Drops both references (used by tests). */
export function clearPanels(): void {
	sidebarPanel = undefined
	tabPanel = undefined
}
