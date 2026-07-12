/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
	RooCodeEventName,
	TaskBridgeEventName,
	TaskSocketEvents,
	ExtensionSocketEvents,
	TaskBridgeCommandName,
} from "@roo-code/types"

import { BridgeOrchestrator, type BridgeEventSource } from "../BridgeOrchestrator.js"
import type { BridgeProvider } from "../types.js"

/** Minimal EventEmitter standing in for both the socket and the API bus. */
class FakeEmitter {
	handlers = new Map<string, Array<(...a: any[]) => void>>()
	emitted: Array<{ event: string; data: any }> = []
	connected = true
	id = "fake-sid"
	/** Stands in for the socket.io Manager (socket.io property). Lazily created. */
	private _io: FakeEmitter | null = null

	get io(): FakeEmitter {
		// Lazy — avoids infinite recursion in the constructor (each FakeEmitter
		// would create another FakeEmitter for its .io, which creates another…).
		if (!this._io) this._io = new FakeEmitter()
		return this._io
	}

	on(event: string, cb: (...a: any[]) => void) {
		const list = this.handlers.get(event) ?? []
		list.push(cb)
		this.handlers.set(event, list)
	}
	off(event: string, cb: (...a: any[]) => void) {
		const list = this.handlers.get(event) ?? []
		this.handlers.set(
			event,
			list.filter((h) => h !== cb),
		)
	}
	emit(event: string, data?: any) {
		this.emitted.push({ event, data })
	}
	removeAllListeners() {
		this.handlers.clear()
	}
	disconnect() {
		this.connected = false
	}
	/** Test helper: fire a server-pushed event into the orchestrator's listeners. */
	fire(event: string, ...args: any[]) {
		for (const h of this.handlers.get(event) ?? []) h(...args)
	}
}

function makeProvider() {
	const provider: BridgeProvider = {
		getCurrentTask: vi.fn(() => undefined),
		cancelTask: vi.fn(async () => {}),
		showTaskWithId: vi.fn(async () => undefined),
		postStateToWebview: vi.fn(async () => {}),
		contextProxy: { setValue: vi.fn(async () => {}) },
	}
	return provider
}

const CONFIG = {
	userId: "user-1",
	socketBridgeUrl: "http://localhost:8085",
	socketBridgePath: "/bridge/socket.io",
	token: "tok-1",
}

describe("BridgeOrchestrator", () => {
	let socket: FakeEmitter
	let bus: FakeEmitter
	let provider: BridgeProvider
	let ioFactory: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		socket = new FakeEmitter()
		bus = new FakeEmitter()
		provider = makeProvider()
		ioFactory = vi.fn(() => socket)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function build() {
		return new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider,
			events: bus as unknown as BridgeEventSource,
			workspacePath: "/work",
			snapshot: vi.fn(async () => ({ mode: "code", isRunning: true })),
			ioFactory: ioFactory as any,
		})
	}

	it("does not connect until start() is called", async () => {
		build()
		expect(ioFactory).not.toHaveBeenCalled()
	})

	it("connects and registers the instance on socket connect", async () => {
		const orch = build()
		await orch.start()
		expect(ioFactory).toHaveBeenCalledWith(
			CONFIG.socketBridgeUrl,
			expect.objectContaining({ path: CONFIG.socketBridgePath }),
		)

		socket.fire("connect")
		const register = socket.emitted.find((e) => e.event === ExtensionSocketEvents.REGISTER)
		expect(register).toBeTruthy()
		expect(register!.data).toMatchObject({ userId: "user-1", workspacePath: "/work" })
	})

	it("forwards API Message bus events to the task:event channel", async () => {
		const orch = build()
		await orch.start()
		bus.fire(RooCodeEventName.Message, { taskId: "task-9", action: "created", message: { ts: 1, type: "say" } })

		const evt = socket.emitted.find((e) => e.event === TaskSocketEvents.EVENT)
		expect(evt).toBeTruthy()
		expect(evt!.data).toMatchObject({
			type: TaskBridgeEventName.Message,
			taskId: "task-9",
			action: "created",
			// Each window stamps its own worktree root so the backend can attribute
			// the task correctly even when several windows share one cloud account.
			workspacePath: "/work",
		})
	})

	it("dispatches a relayed stop_task command to the provider", async () => {
		const orch = build()
		await orch.start()
		socket.fire(TaskSocketEvents.RELAYED_COMMAND, {
			type: TaskBridgeCommandName.StopTask,
			taskId: "task-9",
			timestamp: 1,
		})
		await vi.runAllTimersAsync()
		expect(provider.cancelTask).toHaveBeenCalledTimes(1)
	})

	it("ignores malformed relayed commands without throwing", async () => {
		const orch = build()
		await orch.start()
		socket.fire(TaskSocketEvents.RELAYED_COMMAND, { type: "not_a_command", foo: 1 })
		await vi.runAllTimersAsync()
		expect(provider.cancelTask).not.toHaveBeenCalled()
	})

	it("stop() tears down and stops forwarding bus events", async () => {
		const orch = build()
		await orch.start()
		await orch.stop()
		expect(socket.connected).toBe(false)

		// A bus event after stop must not be forwarded (listeners removed).
		const before = socket.emitted.length
		bus.fire(RooCodeEventName.Message, { taskId: "t", action: "x", message: {} })
		expect(socket.emitted.length).toBe(before)
	})

	it("logs connect_error with auth/network classification", async () => {
		const logs: string[] = []
		const orch = new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider,
			events: bus as unknown as BridgeEventSource,
			workspacePath: "/work",
			snapshot: vi.fn(async () => ({ mode: "code", isRunning: true })),
			ioFactory: ioFactory as any,
			log: (...args: unknown[]) => logs.push(args.join(" ")),
		})
		await orch.start()
		socket.fire("connect_error", new Error("token expired"))
		expect(
			logs.some((l) => l.includes("connect_error") && l.includes("token expired") && l.includes("(auth)")),
		).toBe(true)

		socket.fire("connect_error", new Error("xhr poll error"))
		expect(
			logs.some(
				(l) => l.includes("connect_error") && l.includes("xhr poll error") && l.includes("(network/server)"),
			),
		).toBe(true)
	})

	it("logs reconnect_attempt #1 and every 5th, skips 2-4", async () => {
		const logs: string[] = []
		const orch = new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider,
			events: bus as unknown as BridgeEventSource,
			workspacePath: "/work",
			snapshot: vi.fn(async () => ({ mode: "code", isRunning: true })),
			ioFactory: ioFactory as any,
			log: (...args: unknown[]) => logs.push(args.join(" ")),
		})
		await orch.start()
		const manager = (socket as any).io as FakeEmitter

		// Attempt 1 — logged
		manager.fire("reconnect_attempt", 1)
		expect(logs.some((l) => l.includes("reconnect attempt #1"))).toBe(true)

		// Attempts 2-4 — NOT logged (throttled)
		logs.length = 0
		manager.fire("reconnect_attempt", 2)
		manager.fire("reconnect_attempt", 3)
		manager.fire("reconnect_attempt", 4)
		expect(logs.filter((l) => l.includes("reconnect attempt"))).toHaveLength(0)

		// Attempt 5 — logged
		manager.fire("reconnect_attempt", 5)
		expect(logs.some((l) => l.includes("reconnect attempt #5"))).toBe(true)
	})

	it("logs reconnect_failed when manager gives up", async () => {
		const logs: string[] = []
		const orch = new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider,
			events: bus as unknown as BridgeEventSource,
			workspacePath: "/work",
			snapshot: vi.fn(async () => ({ mode: "code", isRunning: true })),
			ioFactory: ioFactory as any,
			log: (...args: unknown[]) => logs.push(args.join(" ")),
		})
		await orch.start()
		const manager = (socket as any).io as FakeEmitter

		manager.fire("reconnect_failed")
		expect(logs.some((l) => l.includes("reconnect failed") && l.includes("offline"))).toBe(true)
	})

	it("cleans up manager-level listeners on stop()", async () => {
		const orch = build()
		await orch.start()
		const manager = (socket as any).io as FakeEmitter
		expect(manager.handlers.get("reconnect_attempt")?.length ?? 0).toBeGreaterThan(0)
		expect(manager.handlers.get("reconnect_failed")?.length ?? 0).toBeGreaterThan(0)
		await orch.stop()
		expect(manager.handlers.get("reconnect_attempt")?.length ?? 0).toBe(0)
		expect(manager.handlers.get("reconnect_failed")?.length ?? 0).toBe(0)
	})

	it("resets reconnect counter on successful connect", async () => {
		const logs: string[] = []
		const orch = new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider,
			events: bus as unknown as BridgeEventSource,
			workspacePath: "/work",
			snapshot: vi.fn(async () => ({ mode: "code", isRunning: true })),
			ioFactory: ioFactory as any,
			log: (...args: unknown[]) => logs.push(args.join(" ")),
		})
		await orch.start()
		const manager = (socket as any).io as FakeEmitter

		// Simulate a few reconnect attempts
		manager.fire("reconnect_attempt", 3)
		// Successful connect resets the counter
		socket.fire("connect")
		// Next attempt 1 should be logged again (counter was reset)
		logs.length = 0
		manager.fire("reconnect_attempt", 1)
		expect(logs.some((l) => l.includes("reconnect attempt #1"))).toBe(true)
	})
})
