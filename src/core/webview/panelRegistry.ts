import delay from "delay"
import * as vscode from "vscode"

import type { RunningTaskStatus } from "@tumble-code/types"
import { findLast } from "@tumble-code/core/browser"

import { Package } from "../../shared/package"
import { logger } from "../../utils/logging"
import type { ClineProvider } from "./ClineProvider"

/**
 * The Tumble Code panels of this window: the sidebar and every editor tab,
 * one ClineProvider each. Answers "which panel" questions for the commands,
 * the URI handler, the API and the remote-control bridge, and shares what all
 * panels show (the working tasks, state pushes for settings that live outside
 * the ContextProxy). Each provider registers itself on construction and
 * leaves when its dispose ends.
 */
class PanelRegistry {
	private readonly panels = new Set<ClineProvider>()
	private readonly observers = new Set<(provider: ClineProvider) => void>()
	/**
	 * When the user was last in each panel: bumped each time a panel is
	 * resolved, focused (an editor tab) or shown (the sidebar). With several
	 * editor tabs open, "reveal", "focus" and the title-bar buttons act on the
	 * panel the user was in last.
	 */
	private readonly activatedAt = new Map<ClineProvider, number>()
	private activationCount = 0

	add(provider: ClineProvider): void {
		this.panels.add(provider)
		for (const observe of this.observers) {
			observe(provider)
		}
	}

	remove(provider: ClineProvider): void {
		this.panels.delete(provider)
		this.activatedAt.delete(provider)
	}

	markActivated(provider: ClineProvider): void {
		this.activatedAt.set(provider, ++this.activationCount)
	}

	/**
	 * Calls `observe` for every live provider now and for each one created
	 * later: the sidebar and every editor tab, however the tab was opened
	 * (command, API, replacement of an orphaned tab), so the API bus and the
	 * remote-control bridge hear the tasks of every panel.
	 */
	observe(observe: (provider: ClineProvider) => void): vscode.Disposable {
		for (const provider of this.panels) {
			observe(provider)
		}
		this.observers.add(observe)
		return { dispose: () => this.observers.delete(observe) }
	}

	/** Whether another live provider uses the ContextProxy of `provider`. */
	sharesContextProxy(provider: ClineProvider): boolean {
		return Array.from(this.panels).some(
			(other) => other !== provider && other.contextProxy === provider.contextProxy,
		)
	}

	/** The provider (sidebar or editor tab) that has a live task by this id. */
	findTaskHost(taskId: string): ClineProvider | undefined {
		return findLast(
			Array.from(this.panels),
			(provider) => !provider.isDisposed && provider.findLiveTask(taskId) !== undefined,
		)
	}

	/** The editor tab Tumble Code was focused in last, if any tab is open. */
	getEditorTab(): vscode.WebviewPanel | undefined {
		const host = this.mostRecentlyActive((provider) => isEditorTab(provider.panelView))
		return host?.panelView as vscode.WebviewPanel | undefined
	}

	/** Of the panels on screen, the one the user was in last. */
	getVisibleInstance(): ClineProvider | undefined {
		return this.mostRecentlyActive((provider) => provider.panelView?.visible === true)
	}

	/** The panel (sidebar or editor tab) the user was in last, visible or not. */
	getLastActiveInstance(): ClineProvider | undefined {
		return this.mostRecentlyActive((provider) => provider.panelView !== undefined)
	}

	/** The visible panel; when none is, the sidebar is shown first. */
	async getInstance(): Promise<ClineProvider | undefined> {
		const visibleProvider = this.getVisibleInstance()
		if (visibleProvider) {
			return visibleProvider
		}
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		// Wait briefly for the view to become visible
		await delay(100)
		return this.getVisibleInstance()
	}

	/**
	 * Pushes the state (without the chat messages) to every open panel. For
	 * changes that live outside the ContextProxy but show in every panel, such
	 * as the cloud account and the cloud settings.
	 */
	async postStateToAllWebviewsWithoutClineMessages(): Promise<void> {
		await Promise.all(
			Array.from(this.panels).map((provider) =>
				provider
					.postStateToWebviewWithoutClineMessages()
					.catch((error) => logger.debug(`[panelRegistry] state push to a panel failed: ${String(error)}`)),
			),
		)
	}

	/**
	 * The working tasks of every panel in this window, merged, so all panels
	 * show the same statuses on their history rows and sort their lists the
	 * same way. A panel being disposed is left out: its tasks are being
	 * stopped. A task runs in one panel only; should two panels still report
	 * the same id, "awaiting_input" wins, as it does in the webview's
	 * `withAncestors`. Only what is shown is shared: which panel owns a task
	 * stays with its TaskSlot.
	 */
	runningTasks(): Record<string, RunningTaskStatus> {
		const runningTasks: Record<string, RunningTaskStatus> = {}
		for (const provider of this.panels) {
			if (provider.isDisposed) {
				continue
			}
			for (const [taskId, status] of Object.entries(provider.ownRunningTasks())) {
				if (runningTasks[taskId] !== "awaiting_input") {
					runningTasks[taskId] = status
				}
			}
		}
		return runningTasks
	}

	/** Sends every live panel the merged working tasks, each only if its view holds a different map. */
	postRunningTasks(): void {
		const runningTasks = this.runningTasks()
		for (const provider of this.panels) {
			if (!provider.isDisposed) {
				void provider.postRunningTasksIfChanged(runningTasks)
			}
		}
	}

	/**
	 * The live provider matching `filter` that the user was in last. Ties (never
	 * activated) go to the newest. A provider being disposed stays registered
	 * until its async cleanup ends, so it is skipped here: its panel is already
	 * closed.
	 */
	private mostRecentlyActive(filter: (provider: ClineProvider) => boolean): ClineProvider | undefined {
		let best: ClineProvider | undefined
		let bestAt = 0
		for (const provider of this.panels) {
			const at = this.activatedAt.get(provider) ?? 0
			if (!provider.isDisposed && filter(provider) && (!best || at >= bestAt)) {
				best = provider
				bestAt = at
			}
		}
		return best
	}
}

function isEditorTab(view: vscode.WebviewView | vscode.WebviewPanel | undefined): view is vscode.WebviewPanel {
	return view !== undefined && "onDidChangeViewState" in view
}

/** The one registry of this extension host. */
export const panelRegistry = new PanelRegistry()
