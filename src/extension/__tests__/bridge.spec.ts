import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type * as vscode from "vscode"

// DEF-C50: after a server restart the first bridge config fetch can fail (the
// session token expired while the server was down). The bridge must try again
// on its own instead of staying offline until VS Code reloads.

const cloud = vi.hoisted(() => {
	const listeners = new Map<string, Array<() => void>>()
	const state = { authenticated: true }
	const instance = {
		cloudAPI: { bridgeConfig: vi.fn() },
		isAuthenticated: () => state.authenticated,
		on: (event: string, cb: () => void) => listeners.set(event, [...(listeners.get(event) ?? []), cb]),
		off: vi.fn(),
	}
	const starts: Array<() => Promise<void>> = []
	const stops = { count: 0 }
	const created: Array<{ onStatusChange?: (status: string) => void }> = []
	class BridgeOrchestrator {
		constructor(options: { onStatusChange?: (status: string) => void }) {
			created.push(options)
		}
		start = vi.fn(() => {
			const next = starts.shift()
			return next ? next() : Promise.resolve()
		})
		stop = vi.fn(async () => {
			stops.count++
		})
	}
	return {
		state,
		instance,
		listeners,
		starts,
		stops,
		created,
		BridgeOrchestrator,
		emit: (event: string) => (listeners.get(event) ?? []).forEach((cb) => cb()),
	}
})

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		getConfiguration: () => ({ get: () => undefined }),
	},
}))
vi.mock("@roo-code/cloud", async (importOriginal) => ({
	bridgeRetryDelayMs: (await importOriginal<typeof import("@roo-code/cloud")>()).bridgeRetryDelayMs,
	CloudService: { hasInstance: () => true, instance: cloud.instance },
	BridgeOrchestrator: cloud.BridgeOrchestrator,
}))

// R11: bridgeRetryDelayMs now carries equal jitter. Pin the random source so
// the retry ladder below stays exactly 1 s, 2 s, ... — deterministic tests.
vi.spyOn(Math, "random").mockReturnValue(0.999)

import { setupRemoteControlBridge } from "../bridge"
import { getRemoteControlStatus } from "../remoteControlStatus"

describe("setupRemoteControlBridge retry (DEF-C50)", () => {
	let logs: string[]
	let subscriptions: Array<{ dispose: () => void }>

	beforeEach(() => {
		vi.useFakeTimers()
		cloud.state.authenticated = true
		cloud.listeners.clear()
		cloud.starts.length = 0
		cloud.stops.count = 0
		cloud.created.length = 0
		logs = []
		subscriptions = []
	})

	afterEach(() => {
		subscriptions.forEach((s) => s.dispose())
		vi.useRealTimers()
	})

	const postState = vi.fn(async () => {})

	function setup() {
		setupRemoteControlBridge({
			context: { subscriptions } as unknown as vscode.ExtensionContext,
			api: {} as never,
			provider: { postStateToWebview: postState } as never,
			log: (message) => logs.push(message),
		})
	}

	const fail = () => Promise.reject(new Error("401 Unauthorized"))
	const connected = () => logs.filter((l) => l.includes("remote control bridge connected")).length
	const failures = () => logs.filter((l) => l.includes("failed to start")).length

	it("retries a failed start with growing delays until it connects", async () => {
		cloud.starts.push(fail, fail)
		setup()
		await vi.advanceTimersByTimeAsync(0)
		expect(failures()).toBe(1)

		// random()=0.999 → first retry after 999 ms (equal-jitter band, R11).
		await vi.advanceTimersByTimeAsync(998)
		expect(failures()).toBe(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(failures()).toBe(2)

		// Second retry after 1999 ms.
		await vi.advanceTimersByTimeAsync(1998)
		expect(connected()).toBe(0)
		await vi.advanceTimersByTimeAsync(1)
		expect(connected()).toBe(1)
	})

	it("stops retrying after sign-out", async () => {
		cloud.starts.push(fail)
		setup()
		await vi.advanceTimersByTimeAsync(0)
		expect(failures()).toBe(1)

		cloud.state.authenticated = false
		cloud.emit("auth-state-changed")
		await vi.advanceTimersByTimeAsync(120_000)
		expect(failures()).toBe(1)
		expect(connected()).toBe(0)
	})

	it("stops retrying when the extension is disposed", async () => {
		cloud.starts.push(fail)
		setup()
		await vi.advanceTimersByTimeAsync(0)
		subscriptions.forEach((s) => s.dispose())
		subscriptions = []
		await vi.advanceTimersByTimeAsync(120_000)
		expect(failures()).toBe(1)
		expect(connected()).toBe(0)
	})
})

// UI plan §4: the state push carries the bridge status for the CLI status line.
describe("setupRemoteControlBridge status", () => {
	let subscriptions: Array<{ dispose: () => void }>
	const postState = vi.fn(async () => {})

	beforeEach(() => {
		vi.useFakeTimers()
		cloud.state.authenticated = true
		cloud.listeners.clear()
		cloud.starts.length = 0
		cloud.created.length = 0
		postState.mockClear()
		subscriptions = []
	})

	afterEach(() => {
		subscriptions.forEach((s) => s.dispose())
		vi.useRealTimers()
	})

	function setup() {
		setupRemoteControlBridge({
			context: { subscriptions } as unknown as vscode.ExtensionContext,
			api: {} as never,
			provider: { postStateToWebview: postState } as never,
			log: () => {},
		})
	}

	it("follows the orchestrator and pushes state on every change", async () => {
		setup()
		await vi.advanceTimersByTimeAsync(0)

		const options = cloud.created[0]!
		options.onStatusChange?.("connecting")
		expect(getRemoteControlStatus()).toBe("connecting")
		options.onStatusChange?.("connected")
		expect(getRemoteControlStatus()).toBe("connected")
		expect(postState).toHaveBeenCalled()
	})

	it("is offline while a failed start waits for its retry", async () => {
		cloud.starts.push(() => Promise.reject(new Error("fetch failed")))
		setup()
		await vi.advanceTimersByTimeAsync(0)

		expect(getRemoteControlStatus()).toBe("offline")
		expect(postState).toHaveBeenCalled()
	})

	it("is off once signed out", async () => {
		setup()
		await vi.advanceTimersByTimeAsync(0)
		cloud.created[0]!.onStatusChange?.("connected")

		cloud.state.authenticated = false
		cloud.emit("auth-state-changed")
		await vi.advanceTimersByTimeAsync(0)

		expect(getRemoteControlStatus()).toBe("off")
	})
})
