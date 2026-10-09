import * as vscode from "vscode"

import {
	BridgeOrchestrator,
	CloudService,
	bridgeRetryDelayMs,
	type BridgeEventSource,
	type BridgeProvider,
	type InstanceStatePayload,
} from "@tumble-code/cloud"

import { TaskStatus, type RemoteControlStatus } from "@tumble-code/types"

import { ClineProvider } from "../core/webview/ClineProvider"
import { getBridgeRetryDelayMs } from "../activate/cloud-urls"
import type { API } from "./api"
import { setRemoteControlStatus } from "./remoteControlStatus"

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
	// A failed start (bridge config 401 while the server restarts, network error)
	// is retried with backoff while signed in; before, the bridge stayed offline
	// until VS Code reloaded (DEF-C50).
	let startRetry = 0
	let startRetryTimer: ReturnType<typeof setTimeout> | null = null
	let disposed = false

	const clearStartRetry = () => {
		if (startRetryTimer) {
			clearTimeout(startRetryTimer)
			startRetryTimer = null
		}
	}

	// The status line of the CLI reads the bridge status from the state push,
	// so every change pushes state. Never throws: it runs inside socket event
	// handlers and the auth-state listener.
	const reportStatus = (next: RemoteControlStatus) => {
		if (!setRemoteControlStatus(next)) return
		try {
			void Promise.resolve(provider.postStateToWebview()).catch(() => {})
		} catch {
			// A provider that cannot post state yet has nobody to tell.
		}
	}

	const isAuthenticated = () => CloudService.hasInstance() && CloudService.instance.isAuthenticated()

	// Tasks run in parallel: in the sidebar, in editor tabs, detached off
	// screen and as parallel subagents. A command names its task, so it is
	// looked up in every panel instead of meaning the sidebar's current task.
	const bridgeProvider: BridgeProvider = {
		findTask: (taskId: string) => ClineProvider.findTaskHost(taskId)?.findLiveTask(taskId),
		stopTask: async (taskId: string) => (await ClineProvider.findTaskHost(taskId)?.stopTask(taskId)) ?? false,
		// A task still live in a tab resumes there; any other opens in the sidebar.
		resumeTask: (id: string) => (ClineProvider.findTaskHost(id) ?? provider).resumeTask(id),
		// Auto-approval is one setting for every panel.
		postStateToWebview: () => ClineProvider.postStateToAllWebviewsWithoutClineMessages(),
		contextProxy: {
			// The bridge protocol carries untyped key/value pairs; ContextProxy.setValue
			// wants a known settings key with its value type, which only the remote
			// caller knows, so the cast stays.
			setValue: (key: string, value: unknown) => provider.contextProxy.setValue(key as any, value as any),
		},
	}

	const snapshot = async (taskId: string): Promise<InstanceStatePayload | null> => {
		// The snapshot describes the task it is sent for, wherever it runs.
		const host = ClineProvider.findTaskHost(taskId)
		const task = host?.findLiveTask(taskId)
		const state = await (host ?? provider).getState()
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
		let mode = state.mode
		try {
			mode = task?.taskMode ?? mode
		} catch {
			// The task's mode is not initialized yet; the panel's mode stands in.
		}
		return {
			mode,
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
		if (orchestrator || disposed) return
		clearStartRetry()
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
			// Re-arm the connector after socket.io gives up reconnecting (R11).
			// Read at every start so the setting applies without a reload.
			reconnectRearmDelayMs: getBridgeRetryDelayMs(),
			log: (...args: unknown[]) => log(`[bridge] ${args.map(String).join(" ")}`),
			onStatusChange: reportStatus,
		})
		reportStatus("connecting")
		try {
			await orchestrator.start()
			startRetry = 0
			log("[bridge] remote control bridge connected")
		} catch (error) {
			orchestrator = null
			reportStatus("offline")
			const delay = bridgeRetryDelayMs(startRetry++)
			log(
				`[bridge] failed to start: ${error instanceof Error ? error.message : String(error)}; ` +
					`retrying in ${Math.round(delay / 1000)} s`,
			)
			startRetryTimer = setTimeout(() => {
				startRetryTimer = null
				if (isAuthenticated()) void start()
			}, delay)
		}
	}

	const stop = async () => {
		clearStartRetry()
		startRetry = 0
		reportStatus("off")
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
	context.subscriptions.push({
		dispose: () => {
			disposed = true
			void stop()
		},
	})

	reconcile()
}
