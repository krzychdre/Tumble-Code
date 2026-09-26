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
	class BridgeOrchestrator {
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
		BridgeOrchestrator,
		emit: (event: string) => (listeners.get(event) ?? []).forEach((cb) => cb()),
	}
})

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] } }))
vi.mock("@roo-code/cloud", async (importOriginal) => ({
	bridgeRetryDelayMs: (await importOriginal<typeof import("@roo-code/cloud")>()).bridgeRetryDelayMs,
	CloudService: { hasInstance: () => true, instance: cloud.instance },
	BridgeOrchestrator: cloud.BridgeOrchestrator,
}))

import { setupRemoteControlBridge } from "../bridge"

describe("setupRemoteControlBridge retry (DEF-C50)", () => {
	let logs: string[]
	let subscriptions: Array<{ dispose: () => void }>

	beforeEach(() => {
		vi.useFakeTimers()
		cloud.state.authenticated = true
		cloud.listeners.clear()
		cloud.starts.length = 0
		cloud.stops.count = 0
		logs = []
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
			provider: {} as never,
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

		await vi.advanceTimersByTimeAsync(999)
		expect(failures()).toBe(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(failures()).toBe(2)

		await vi.advanceTimersByTimeAsync(1999)
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
