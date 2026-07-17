import * as vscode from "vscode"

import {
	BridgeOrchestrator,
	CloudService,
	type BridgeEventSource,
	type BridgeProvider,
	type InstanceStatePayload,
} from "@roo-code/cloud"

import { TaskStatus } from "@roo-code/types"

import type { ClineProvider } from "../core/webview/ClineProvider"
import type { API } from "./api"

/**
 * Wire the live remote-control bridge to the extension. There is no opt-in
 * setting: the bridge is bound to the cloud session. A cloud session is what
 * supplies the bridge token + user identity, so the orchestrator starts on
 * sign-in and stops on sign-out — once you are logged into the cloud, a task is
 * remote-controllable the moment it is shared.
 *
 * Hard constraint: all traffic is extension ↔ backend ↔ browser. This connects
 * the extension to the backend socket.io relay; there is never a direct
 * VS Code ↔ browser link.
 */
export function setupRemoteControlBridge(opts: {
	context: vscode.ExtensionContext
	api: API
	provider: ClineProvider
	log: (message: string) => void
}): void {
	const { context, api, provider, log } = opts

	let orchestrator: BridgeOrchestrator | null = null

	const isAuthenticated = () => CloudService.hasInstance() && CloudService.instance.isAuthenticated()

	const bridgeProvider: BridgeProvider = {
		getCurrentTask: () => provider.getCurrentTask() as unknown as ReturnType<BridgeProvider["getCurrentTask"]>,
		cancelTask: () => provider.cancelTask(),
		showTaskWithId: (id: string) => provider.showTaskWithId(id),
		postStateToWebview: () => provider.postStateToWebview(),
		contextProxy: {
			setValue: (key: string, value: unknown) => provider.contextProxy.setValue(key as any, value as any),
		},
	}

	const snapshot = async (taskId: string): Promise<InstanceStatePayload | null> => {
		const task = provider.getCurrentTask()
		const state = await provider.getState()
		const tokenUsage = task?.getTokenUsage?.()
		let contextWindow: number | undefined
		try {
			contextWindow = task?.api?.getModel().info.contextWindow
		} catch {
			contextWindow = undefined
		}
		// `task.abort` only flips after an explicit abort, so an idle task (turn
		// finished, awaiting input) would falsely report running and keep the web
		// cockpit's Stop button live. `taskStatus` is the authoritative signal:
		// running while streaming or blocked on an interactive approval, idle/
		// resumable once the turn is done.
		const status = task?.taskStatus
		const isRunning = status === TaskStatus.Running || status === TaskStatus.Interactive
		return {
			mode: state.mode,
			isRunning,
			autoApproval: {
				autoApprovalEnabled: state.autoApprovalEnabled,
				autoApprovalMode: state.autoApprovalMode,
				alwaysAllowReadOnly: state.alwaysAllowReadOnly,
				alwaysAllowWrite: state.alwaysAllowWrite,
				alwaysAllowExecute: state.alwaysAllowExecute,
				alwaysAllowMcp: state.alwaysAllowMcp,
				alwaysAllowModeSwitch: state.alwaysAllowModeSwitch,
				alwaysAllowSubtasks: state.alwaysAllowSubtasks,
				alwaysApprovePlan: state.alwaysApprovePlan,
			},
			tokenUsage,
			contextTokens: tokenUsage?.contextTokens,
			contextWindow,
			currentAsk: task?.taskAsk,
		}
	}

	const start = async () => {
		if (orchestrator) return
		const cloudAPI = CloudService.hasInstance() ? CloudService.instance.cloudAPI : null
		if (!cloudAPI || !CloudService.instance.isAuthenticated()) {
			log("[bridge] no active cloud session; will connect after sign-in")
			return
		}
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
		orchestrator = new BridgeOrchestrator({
			getBridgeConfig: () => cloudAPI.bridgeConfig(),
			provider: bridgeProvider,
			events: api as unknown as BridgeEventSource,
			workspacePath,
			snapshot,
			log: (...args: unknown[]) => log(`[bridge] ${args.map(String).join(" ")}`),
		})
		try {
			await orchestrator.start()
			log("[bridge] remote control bridge connected")
		} catch (error) {
			log(`[bridge] failed to start: ${error instanceof Error ? error.message : String(error)}`)
			orchestrator = null
		}
	}

	const stop = async () => {
		if (!orchestrator) return
		await orchestrator.stop()
		orchestrator = null
		log("[bridge] remote control bridge disconnected")
	}

	// Registered as the synchronous `auth-state-changed` listener below. The cloud
	// AuthService emits that event from inside changeState()/refreshSession(), so any
	// exception thrown here would propagate up and corrupt the auth state machine
	// (it once logged the user out on every backend restart). Never let it throw.
	const reconcile = () => {
		try {
			if (isAuthenticated()) {
				void start()
			} else {
				void stop()
			}
		} catch (error) {
			log(`[bridge] reconcile error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	// Follow the cloud session: connect on sign-in, disconnect on sign-out.
	if (CloudService.hasInstance()) {
		CloudService.instance.on("auth-state-changed", reconcile)
		context.subscriptions.push({ dispose: () => CloudService.instance.off("auth-state-changed", reconcile) })
	}
	context.subscriptions.push({ dispose: () => void stop() })

	reconcile()
}
