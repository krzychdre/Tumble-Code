// cd src && ./node_modules/.bin/vitest run extension/__tests__/api-tab-provider-events.spec.ts

/**
 * A task run in an editor tab must reach the API bus. The remote-control
 * bridge stores task messages in the cloud from that bus; when the API only
 * listened to the sidebar, a tab opened by the "open in new tab" command (or
 * the replacement of an orphaned tab after a host restart) streamed nothing,
 * and the cloud showed the task's cost and tokens (telemetry) but no task.
 *
 * ClineProvider is mocked with an instance registry that behaves like the real
 * `observeInstances`: it replays the live providers, then reports new ones.
 */

import { EventEmitter } from "events"

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type * as vscode from "vscode"
import { TumbleCodeEventName } from "@tumble-code/types"

const registry = vi.hoisted(() => ({
	instances: [] as unknown[],
	observers: [] as Array<(provider: unknown) => void>,
}))

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
	commands: { executeCommand: vi.fn() },
}))
vi.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: {
		observeInstances: (observe: (provider: unknown) => void) => {
			registry.instances.forEach(observe)
			registry.observers.push(observe)
			return { dispose: vi.fn() }
		},
	},
}))
vi.mock("../../activate/registerCommands", () => ({ openClineInNewTab: vi.fn() }))

import { API } from "../api"
import type { ClineProvider } from "../../core/webview/ClineProvider"

/** A provider stand-in that joins the registry the way the real constructor does. */
function makeProvider() {
	const provider = Object.assign(new EventEmitter(), { context: { subscriptions: [] } })
	registry.instances.push(provider)
	registry.observers.forEach((observe) => observe(provider))
	return provider
}

function makeTask(taskId: string) {
	return Object.assign(new EventEmitter(), { taskId })
}

const message = (ts: number) => ({ action: "created", message: { ts, type: "say", say: "text", text: "hi" } })

describe("API hears tasks of every provider, not just the sidebar", () => {
	let sidebar: ReturnType<typeof makeProvider>
	let api: API
	let heard: Mock<(...args: unknown[]) => void>

	beforeEach(() => {
		registry.instances.length = 0
		registry.observers.length = 0
		sidebar = makeProvider()
		const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		api = new API(outputChannel, sidebar as unknown as ClineProvider)
		heard = vi.fn<(...args: unknown[]) => void>()
		api.on(TumbleCodeEventName.Message, heard)
	})

	it("forwards a message of a task in a tab opened after the API started", () => {
		const tab = makeProvider()
		const task = makeTask("tab-task")
		tab.emit(TumbleCodeEventName.TaskCreated, task)

		task.emit(TumbleCodeEventName.Message, message(1))

		expect(heard).toHaveBeenCalledTimes(1)
		expect(heard).toHaveBeenCalledWith(expect.objectContaining({ taskId: "tab-task", action: "created" }))
	})

	it("forwards a sidebar message once, although the sidebar is also a replayed instance", () => {
		const task = makeTask("sidebar-task")
		sidebar.emit(TumbleCodeEventName.TaskCreated, task)

		task.emit(TumbleCodeEventName.Message, message(2))

		expect(heard).toHaveBeenCalledTimes(1)
	})
})
