import { io, type Socket } from "socket.io-client"

import {
	RooCodeEventName,
	TaskBridgeEventName,
	TaskSocketEvents,
	ExtensionSocketEvents,
	HEARTBEAT_INTERVAL_MS,
	taskBridgeCommandSchema,
	type TaskBridgeCommand,
} from "@roo-code/types"

import { dispatchBridgeCommand } from "./commandHandlers.js"
import type { BridgeConfig, BridgeProvider, InstanceStatePayload } from "./types.js"

type Logger = (...args: unknown[]) => void

type BusListener = (...args: unknown[]) => void

/** The slice of the extension `API` event bus the orchestrator subscribes to. */
export interface BridgeEventSource {
	on(event: string, listener: BusListener): void
	off(event: string, listener: BusListener): void
}

export interface BridgeOrchestratorOptions {
	/** Fetch a fresh bridge config (short-lived token) — re-called on every (re)connect. */
	getBridgeConfig: () => Promise<BridgeConfig>
	provider: BridgeProvider
	events: BridgeEventSource
	workspacePath: string
	/** Build the live header/control snapshot for the active task. */
	snapshot: (taskId: string) => Promise<InstanceStatePayload | null>
	log?: Logger
	/** Injectable for tests; defaults to the real socket.io-client. */
	ioFactory?: typeof io
}

/**
 * Connects the extension to the cloud socket.io bridge and wires it both ways:
 *
 * - **up** (extension → server): registers an instance, heartbeats, and forwards
 *   live task events (`message`, `instanceState`) so the web cockpit renders live.
 * - **down** (server → extension): receives relayed browser commands and dispatches
 *   them to the verified control entry points via {@link dispatchBridgeCommand}.
 *
 * The orchestrator only ever connects when started (the opt-in setting gate lives
 * in the extension host); `stop()` fully tears down the socket, heartbeat, and bus
 * subscriptions so toggling the setting off severs remote control immediately.
 */
export class BridgeOrchestrator {
	private socket: Socket | null = null
	private heartbeat: ReturnType<typeof setInterval> | null = null
	private userId: string | null = null
	private started = false
	private readonly listeners: Array<[string, BusListener]> = []

	constructor(private readonly options: BridgeOrchestratorOptions) {}

	private log(...args: unknown[]) {
		this.options.log?.("[BridgeOrchestrator]", ...args)
	}

	get isConnected(): boolean {
		return this.socket?.connected ?? false
	}

	async start(): Promise<void> {
		if (this.started) return
		this.started = true

		const config = await this.options.getBridgeConfig()
		this.userId = config.userId

		const factory = this.options.ioFactory ?? io
		const socket = factory(config.socketBridgeUrl, {
			path: config.socketBridgePath || "/bridge/socket.io",
			transports: ["websocket", "polling"],
			// Re-mint the short-lived token on every (re)connect attempt.
			auth: async (cb: (data: Record<string, unknown>) => void) => {
				try {
					const fresh = await this.options.getBridgeConfig()
					cb({ token: fresh.token })
				} catch {
					cb({ token: config.token })
				}
			},
		})
		this.socket = socket

		socket.on("connect", () => {
			this.log("connected", socket.id)
			this.register()
			this.startHeartbeat()
		})
		socket.on("disconnect", (reason: string) => this.log("disconnected", reason))
		socket.on(TaskSocketEvents.RELAYED_COMMAND, (data: unknown) => void this.onRelayedCommand(data))
		socket.on(ExtensionSocketEvents.RELAYED_COMMAND, (data: unknown) => void this.onRelayedCommand(data))

		this.subscribeToBus()
	}

	async stop(): Promise<void> {
		if (!this.started) return
		this.started = false
		this.stopHeartbeat()
		this.unsubscribeFromBus()
		if (this.socket) {
			try {
				this.socket.emit(ExtensionSocketEvents.UNREGISTER, {})
			} catch {
				// best-effort
			}
			this.socket.removeAllListeners()
			this.socket.disconnect()
			this.socket = null
		}
		this.userId = null
	}

	// --- extension → server -------------------------------------------------

	private register() {
		if (!this.socket || !this.userId) return
		this.socket.emit(ExtensionSocketEvents.REGISTER, {
			userId: this.userId,
			workspacePath: this.options.workspacePath,
			lastHeartbeat: Date.now(),
		})
	}

	private startHeartbeat() {
		this.stopHeartbeat()
		this.heartbeat = setInterval(() => {
			this.socket?.emit(ExtensionSocketEvents.HEARTBEAT, {})
		}, HEARTBEAT_INTERVAL_MS)
	}

	private stopHeartbeat() {
		if (this.heartbeat) {
			clearInterval(this.heartbeat)
			this.heartbeat = null
		}
	}

	private subscribeToBus() {
		const onMessage: BusListener = (...args) => {
			const payload = args[0] as { taskId: string; action?: string; message: unknown }
			this.socket?.emit(TaskSocketEvents.EVENT, {
				type: TaskBridgeEventName.Message,
				taskId: payload.taskId,
				action: payload.action ?? "",
				message: payload.message,
			})
		}
		const onState: BusListener = (...args) => void this.pushInstanceState(args[0] as string)

		this.add(RooCodeEventName.Message, onMessage)
		this.add(RooCodeEventName.TaskModeSwitched, onState)
		this.add(RooCodeEventName.TaskTokenUsageUpdated, onState)
		this.add(RooCodeEventName.TaskAskResponded, onState)
		this.add(RooCodeEventName.TaskInteractive, onState)
		// Terminal/idle transitions flip isRunning false; without these the cockpit
		// would keep showing Stop after a running task finishes.
		this.add(RooCodeEventName.TaskIdle, onState)
		this.add(RooCodeEventName.TaskResumable, onState)
		this.add(RooCodeEventName.TaskCompleted, onState)
		this.add(RooCodeEventName.TaskAborted, onState)
	}

	private add(event: string, listener: BusListener) {
		this.options.events.on(event, listener)
		this.listeners.push([event, listener])
	}

	private unsubscribeFromBus() {
		for (const [event, listener] of this.listeners) {
			this.options.events.off(event, listener)
		}
		this.listeners.length = 0
	}

	private async pushInstanceState(taskId: string) {
		if (!this.socket || !taskId) return
		try {
			const state = await this.options.snapshot(taskId)
			if (!state) return
			this.socket.emit(TaskSocketEvents.EVENT, {
				type: TaskBridgeEventName.InstanceState,
				taskId,
				...state,
			})
		} catch (error) {
			this.log("snapshot failed", error)
		}
	}

	// --- server → extension -------------------------------------------------

	private async onRelayedCommand(data: unknown) {
		const parsed = taskBridgeCommandSchema.safeParse(data)
		if (!parsed.success) {
			this.log("dropped malformed command", parsed.error?.message)
			return
		}
		const command: TaskBridgeCommand = parsed.data
		try {
			await dispatchBridgeCommand(command, this.options.provider)
		} catch (error) {
			this.log("command dispatch failed", command.type, error)
		}
	}
}
