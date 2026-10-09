/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { BridgeOrchestrator, bridgeRetryDelayMs } from "../BridgeOrchestrator.js"
import type { BridgeProvider } from "../types.js"

// R11: after socket.io's manager exhausts its reconnection attempts it emits
// `reconnect_failed` and the socket is dead. With `reconnectRearmDelayMs` set,
// the orchestrator re-arms the connector (socket.connect()) and keeps doing so
// with exponential backoff; with 0 it keeps the old give-up behaviour.

/** Minimal EventEmitter standing in for the socket and its manager. */
class FakeEmitter {
	handlers = new Map<string, Array<(...a: any[]) => void>>()
	emitted: Array<{ event: string; data: any }> = []
	connected = true
	active = true
	connectCalls = 0
	private _io: FakeEmitter | null = null

	get io(): FakeEmitter {
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
	connect() {
		this.connectCalls++
		this.active = true
	}
	fire(event: string, ...args: any[]) {
		for (const h of this.handlers.get(event) ?? []) h(...args)
	}
}

function makeProvider() {
	const provider: BridgeProvider = {
		findTask: vi.fn(() => undefined),
		stopTask: vi.fn(async () => false),
		resumeTask: vi.fn(async () => true),
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

describe("BridgeOrchestrator reconnect re-arm (R11)", () => {
	let socket: FakeEmitter
	let bus: FakeEmitter
	let ioFactory: ReturnType<typeof vi.fn>
	let provider: BridgeProvider
	let logs: string[]

	beforeEach(() => {
		vi.useFakeTimers()
		socket = new FakeEmitter()
		bus = new FakeEmitter()
		provider = makeProvider()
		logs = []
		ioFactory = vi.fn(() => socket)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function build(opts?: { reconnectRearmDelayMs?: number; random?: () => number }) {
		return new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider,
			events: bus as unknown as any,
			workspacePath: "/work",
			snapshot: vi.fn(async () => ({ mode: "code", isRunning: true })),
			ioFactory: ioFactory as any,
			log: (...args: unknown[]) => logs.push(args.join(" ")),
			...opts,
		})
	}

	it("keeps the old give-up behaviour when reconnectRearmDelayMs is unset", async () => {
		const orch = build()
		await orch.start()
		const manager = (socket as any).io as FakeEmitter

		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(600_000)
		expect(socket.connectCalls).toBe(0)
		expect(logs.some((l) => l.includes("giving up"))).toBe(true)
	})

	it("re-arms the connector after reconnect_failed when reconnectRearmDelayMs is set", async () => {
		const orch = build({ reconnectRearmDelayMs: 5_000, random: () => 1 })
		await orch.start()
		const manager = (socket as any).io as FakeEmitter

		// The manager gave up: the socket is dead.
		socket.connected = false
		manager.fire("reconnect_failed")
		expect(logs.some((l) => l.includes("re-arming"))).toBe(true)

		await vi.advanceTimersByTimeAsync(4_999)
		expect(socket.connectCalls).toBe(0)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.connectCalls).toBe(1)
	})

	it("backs off exponentially on repeated failed re-arms and resets after a connect", async () => {
		const orch = build({ reconnectRearmDelayMs: 5_000, random: () => 1 })
		await orch.start()
		const manager = (socket as any).io as FakeEmitter
		socket.connected = false

		// First re-arm fires at the configured 5 s (t = 5 s).
		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(5_000)
		expect(socket.connectCalls).toBe(1)

		// The re-armed cycle also fails → the next re-arm backs off with
		// bridgeRetryDelayMs(0) = [0.5, 1] s; with random()=1 it is 1 s
		// (fires at t = 6 s).
		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(999)
		expect(socket.connectCalls).toBe(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.connectCalls).toBe(2)

		// Next failure doubles the delay: bridgeRetryDelayMs(1) = 2 s
		// (fires at t = 8 s).
		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(1_999)
		expect(socket.connectCalls).toBe(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.connectCalls).toBe(3)

		// A successful connect resets the backoff ladder.
		socket.connected = true
		socket.fire("connect")
		socket.connected = false
		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(5_000)
		expect(socket.connectCalls).toBe(4)
	})

	it("applies jitter to the re-arm delay (seeded random)", async () => {
		const orch = build({ reconnectRearmDelayMs: 5_000, random: () => 0 })
		await orch.start()
		const manager = (socket as any).io as FakeEmitter
		socket.connected = false

		// First delay is the literal configured value (no jitter)…
		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(5_000)
		expect(socket.connectCalls).toBe(1)

		// …subsequent ones use bridgeRetryDelayMs with the injected random:
		// random()=0 → half of 1 s = 500 ms (fires at t = 5.5 s).
		manager.fire("reconnect_failed")
		await vi.advanceTimersByTimeAsync(499)
		expect(socket.connectCalls).toBe(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.connectCalls).toBe(2)
	})

	it("stop() cancels a pending re-arm", async () => {
		const orch = build({ reconnectRearmDelayMs: 5_000, random: () => 1 })
		await orch.start()
		const manager = (socket as any).io as FakeEmitter
		socket.connected = false

		manager.fire("reconnect_failed")
		await orch.stop()
		await vi.advanceTimersByTimeAsync(600_000)
		expect(socket.connectCalls).toBe(0)
	})
})

describe("bridgeRetryDelayMs jitter (R11)", () => {
	it("returns half the raw delay for random()=0 and nearly all of it for random()≈1", () => {
		expect(bridgeRetryDelayMs(0, () => 0)).toBe(500)
		expect(bridgeRetryDelayMs(0, () => 0.999)).toBe(999)
		expect(bridgeRetryDelayMs(1, () => 0)).toBe(1_000)
		expect(bridgeRetryDelayMs(1, () => 0.999)).toBe(1_999)
	})

	it("stays within [raw/2, raw] and never exceeds the one-minute cap", () => {
		for (let attempt = 0; attempt <= 20; attempt++) {
			const delay = bridgeRetryDelayMs(attempt, () => 0.999)
			// Once capped (attempt ≥ 6), the band is [30 s, 60 s].
			expect(delay).toBeLessThanOrEqual(60_000)
			expect(delay).toBeGreaterThanOrEqual(Math.floor(Math.min(1_000 * 2 ** attempt, 60_000) / 2))
		}
	})
})

// UI plan §4: the CLI status line shows whether the bridge is connected and
// marks it offline. The orchestrator reports each change of its connection.
describe("BridgeOrchestrator connection status", () => {
	let socket: FakeEmitter
	let statuses: string[]

	beforeEach(() => {
		socket = new FakeEmitter()
		statuses = []
	})

	async function startOrchestrator() {
		const orch = new BridgeOrchestrator({
			getBridgeConfig: vi.fn(async () => CONFIG),
			provider: makeProvider(),
			events: new FakeEmitter() as unknown as any,
			workspacePath: "/work",
			snapshot: vi.fn(async () => null),
			ioFactory: vi.fn(() => socket) as any,
			onStatusChange: (status) => statuses.push(status),
		})
		await orch.start()
		return orch
	}

	it("is connecting until the socket connects, then connected", async () => {
		const orch = await startOrchestrator()
		expect(statuses).toEqual(["connecting"])
		expect(orch.status).toBe("connecting")

		socket.fire("connect")

		expect(statuses).toEqual(["connecting", "connected"])
		expect(orch.status).toBe("connected")
	})

	it("is offline after a failed connection attempt, even while socket.io keeps retrying", async () => {
		const orch = await startOrchestrator()

		socket.fire("connect_error", new Error("xhr poll error"))

		expect(orch.status).toBe("offline")
		expect(statuses.at(-1)).toBe("offline")
	})

	it("is connecting after a drop socket.io will retry, offline after one it will not", async () => {
		const orch = await startOrchestrator()
		socket.fire("connect")

		socket.active = true
		socket.fire("disconnect", "transport close")
		expect(orch.status).toBe("connecting")

		socket.fire("connect")
		socket.active = false
		socket.fire("disconnect", "io server disconnect")
		expect(orch.status).toBe("offline")
	})

	it("is offline once the manager gives up reconnecting", async () => {
		const orch = await startOrchestrator()

		;(socket.io as FakeEmitter).fire("reconnect_failed")

		expect(orch.status).toBe("offline")
	})

	it("reports a status only when it changes", async () => {
		await startOrchestrator()

		socket.fire("connect_error", new Error("a"))
		socket.fire("connect_error", new Error("b"))

		expect(statuses).toEqual(["connecting", "offline"])
	})
})
