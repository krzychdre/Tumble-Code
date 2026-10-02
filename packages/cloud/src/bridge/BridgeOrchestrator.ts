import { io, type Socket } from "socket.io-client"

import {
	TumbleCodeEventName,
	TaskBridgeEventName,
	TaskSocketEvents,
	ExtensionSocketEvents,
	HEARTBEAT_INTERVAL_MS,
	taskBridgeCommandSchema,
	type TaskBridgeCommand,
	type RemoteControlStatus,
} from "@tumble-code/types"

import { backoffDelayMs } from "../backoff.js"
import { dispatchBridgeCommand } from "./commandHandlers.js"
import type { BridgeConfig, BridgeProvider, InstanceStatePayload } from "./types.js"

type Logger = (...args: unknown[]) => void

type BusListener = (...args: unknown[]) => void

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60_000

/**
 * Delay before the given retry (0-based) of a bridge connection the server
 * refused: 1 s, 2 s, 4 s, ... capped at one minute, with equal jitter so
 * windows that restart together do not reconnect on the same tick (R11).
 * Also used by the extension host to retry a bridge start that failed.
 * `random` is injectable for deterministic tests.
 */
export function bridgeRetryDelayMs(attempt: number, random: () => number = Math.random): number {
	return backoffDelayMs(attempt, { baseMs: RETRY_BASE_MS, capMs: RETRY_MAX_MS, random })
}

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
	/**
	 * Re-arm the socket.io manager after `reconnect_failed` (R11). Once the
	 * manager exhausts its reconnection attempts the socket stays dead until
	 * the next VS Code reload; with this delay (milliseconds) the orchestrator
	 * calls `socket.connect()` again, restarting the manager's reconnect
	 * cycle with a fresh bridge token. `0` (default) keeps the old
	 * give-up-after-reconnect_failed behaviour.
	 */
	reconnectRearmDelayMs?: number
	/** Random source in [0, 1) for the re-arm backoff; injectable for deterministic tests. */
	random?: () => number
	/**
	 * Called when the connection changes (UI plan §4, the CLI status line):
	 * "connecting" from start() and after a drop socket.io will retry,
	 * "connected", and "offline" after a failed attempt (even while socket.io
	 * keeps retrying), a drop it will not retry, or when it gives up.
	 */
	onStatusChange?: (status: BridgeConnectionStatus) => void
}

type BridgeConnectionStatus = Exclude<RemoteControlStatus, "off">

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

	/** Reconnect attempt counter for throttled logging. */
	private reconnectAttempt = 0

	/** Manual reconnects after the server refused the handshake (DEF-C50). */
	private refusedRetry = 0
	private refusedRetryTimer: ReturnType<typeof setTimeout> | null = null

	/** Manual re-arms after the manager gave up reconnecting (R11). */
	private rearmRetry = 0
	private rearmTimer: ReturnType<typeof setTimeout> | null = null

	private currentStatus: BridgeConnectionStatus = "connecting"

	constructor(private readonly options: BridgeOrchestratorOptions) {}

	/** The connection as last reported through `onStatusChange`. */
	get status(): BridgeConnectionStatus {
		return this.currentStatus
	}

	private setStatus(status: BridgeConnectionStatus, force = false) {
		if (!force && status === this.currentStatus) return
		this.currentStatus = status
		this.options.onStatusChange?.(status)
	}

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
		this.setStatus("connecting", true)

		socket.on("connect", () => {
			this.setStatus("connected")
			this.reconnectAttempt = 0
			this.refusedRetry = 0
			this.rearmRetry = 0
			this.clearRefusedRetry()
			this.clearRearm()
			this.log("connected", socket.id)
			this.register()
			this.startHeartbeat()
		})
		socket.on("disconnect", (reason: string) => {
			this.log("disconnected", reason)
			// socket.io retries a transport drop by itself (`active` stays true);
			// a server or client disconnect it does not.
			this.setStatus(socket.active ? "connecting" : "offline")
		})
		socket.on("connect_error", (err: Error) => {
			// Auth-shaped failures (token rejected, expired) have distinctive messages;
			// surface the type so the user can tell auth issues from network issues.
			this.setStatus("offline")
			const msg = err?.message ?? String(err)
			const isAuthShaped = /token|auth|unauthorized|401|403/i.test(msg)
			this.log("connect_error:", msg, isAuthShaped ? "(auth)" : "(network/server)")
			// A handshake the server refused (for example a token that expired while
			// the server restarted) leaves the socket inactive: socket.io-client does
			// not reconnect it by itself. Reconnect by hand; the `auth` callback then
			// fetches a fresh token. Transport errors keep `active` true because the
			// manager is already retrying them.
			if (!socket.active) this.scheduleRefusedRetry(socket)
		})
		socket.on(TaskSocketEvents.RELAYED_COMMAND, (data: unknown) => void this.onRelayedCommand(data))
		socket.on(ExtensionSocketEvents.RELAYED_COMMAND, (data: unknown) => void this.onRelayedCommand(data))

		// Manager-level reconnection events: socket.io reconnect-loops silently
		// on repeated auth failures. Log with throttling so a long outage doesn't
		// spam the output channel — log attempt 1, then every 5th.
		const manager = socket.io
		manager.on("reconnect_attempt", (attempt: number) => {
			this.reconnectAttempt = attempt
			if (attempt === 1 || attempt % 5 === 0) {
				this.log(`reconnect attempt #${attempt}`)
			}
		})
		manager.on("reconnect_failed", () => {
			this.setStatus("offline")
			const rearm = this.options.reconnectRearmDelayMs ?? 0
			if (rearm > 0) {
				// The manager exhausted its reconnection attempts and the socket
				// is dead. Re-arm it: after `reconnectRearmDelayMs` we call
				// `connect()` again, which restarts the manager's reconnect
				// cycle (with a fresh bridge token via the `auth` callback).
				this.log("reconnect failed — re-arming the connector")
				this.scheduleRearm(socket, rearm)
			} else {
				this.log("reconnect failed — giving up; remote control is offline")
			}
		})

		this.subscribeToBus()
	}

	async stop(): Promise<void> {
		if (!this.started) return
		this.started = false
		this.clearRefusedRetry()
		this.clearRearm()
		this.stopHeartbeat()
		this.unsubscribeFromBus()
		if (this.socket) {
			try {
				this.socket.emit(ExtensionSocketEvents.UNREGISTER, {})
			} catch {
				// best-effort
			}
			// Clean up manager-level reconnection listeners we registered.
			try {
				this.socket.io.removeAllListeners()
			} catch {
				// best-effort — manager may already be torn down
			}
			this.socket.removeAllListeners()
			this.socket.disconnect()
			this.socket = null
		}
		this.userId = null
	}

	private scheduleRefusedRetry(socket: Socket) {
		if (!this.started || this.refusedRetryTimer) return
		const delay = bridgeRetryDelayMs(this.refusedRetry++, this.options.random)
		this.log(`server refused the connection; retrying in ${Math.round(delay / 1000)} s`)
		this.refusedRetryTimer = setTimeout(() => {
			this.refusedRetryTimer = null
			if (this.started && this.socket === socket && !socket.connected) socket.connect()
		}, delay)
	}

	private clearRefusedRetry() {
		if (this.refusedRetryTimer) {
			clearTimeout(this.refusedRetryTimer)
			this.refusedRetryTimer = null
		}
	}

	/** One `reconnect_failed` → one scheduled `connect()`; a pending re-arm is not doubled (R11). */
	private scheduleRearm(socket: Socket, firstDelayMs: number) {
		if (!this.started || this.rearmTimer) return
		const delay =
			this.rearmRetry === 0 ? firstDelayMs : bridgeRetryDelayMs(this.rearmRetry - 1, this.options.random)
		this.log(`re-arming reconnect in ${Math.round(delay / 1000)} s`)
		this.rearmTimer = setTimeout(() => {
			this.rearmTimer = null
			if (this.started && this.socket === socket && !socket.connected) {
				socket.connect()
				// If this re-arm also fails, back off exponentially for the next one.
				this.rearmRetry++
				this.scheduleRearm(socket, firstDelayMs)
			} else {
				this.rearmRetry = 0
			}
		}, delay)
	}

	private clearRearm() {
		if (this.rearmTimer) {
			clearTimeout(this.rearmTimer)
			this.rearmTimer = null
		}
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
				// Stamp this window's worktree root on the event so the backend
				// attributes the task to the project it actually ran in, instead of
				// the user-keyed registry singleton (wrong with multiple windows).
				workspacePath: this.options.workspacePath,
			})
		}
		const onState: BusListener = (...args) => void this.pushInstanceState(args[0] as string)

		this.add(TumbleCodeEventName.Message, onMessage)
		this.add(TumbleCodeEventName.TaskModeSwitched, onState)
		this.add(TumbleCodeEventName.TaskTokenUsageUpdated, onState)
		this.add(TumbleCodeEventName.TaskAskResponded, onState)
		this.add(TumbleCodeEventName.TaskInteractive, onState)
		// Terminal/idle transitions flip isRunning false; without these the cockpit
		// would keep showing Stop after a running task finishes.
		this.add(TumbleCodeEventName.TaskIdle, onState)
		this.add(TumbleCodeEventName.TaskResumable, onState)
		this.add(TumbleCodeEventName.TaskCompleted, onState)
		this.add(TumbleCodeEventName.TaskAborted, onState)
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
