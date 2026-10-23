// cd src && ./node_modules/.bin/vitest run extension/__tests__/api-tab-provider-events.spec.ts

/**
 * A task run in an editor tab must reach the API bus. The remote-control
 * bridge stores task messages in the cloud from that bus; when the API only
 * listened to the sidebar, a tab opened by the "open in new tab" command (or
 * the replacement of an orphaned tab after a host restart) streamed nothing,
 * and the cloud showed the task's cost and tokens (telemetry) but no task.
 *
 * The providers are stand-ins registered in the real panel registry, which
 * replays the live providers to an observer, then reports new ones.
 */

import { EventEmitter } from "events"

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type * as vscode from "vscode"
import { TumbleCodeEventName } from "@tumble-code/types"

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
	commands: { executeCommand: vi.fn() },
}))
vi.mock("../../activate/registerCommands", () => ({ openClineInNewTab: vi.fn() }))

import { API } from "../api"
import type { ClineProvider } from "../../core/webview/ClineProvider"
import { panelRegistry } from "../../core/webview/panelRegistry"

const registered: ClineProvider[] = []

/** A provider stand-in that joins the registry the way the real constructor does. */
function makeProvider() {
	const provider = Object.assign(new EventEmitter(), { context: { subscriptions: [] as vscode.Disposable[] } })
	registered.push(provider as unknown as ClineProvider)
	panelRegistry.add(provider as unknown as ClineProvider)
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
		sidebar = makeProvider()
		const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		api = new API(outputChannel, sidebar as unknown as ClineProvider)
		heard = vi.fn<(...args: unknown[]) => void>()
		api.on(TumbleCodeEventName.Message, heard)
	})

	afterEach(() => {
		// The API's registry observer is in the sidebar's subscriptions.
		sidebar.context.subscriptions.forEach((subscription) => subscription.dispose())
		registered.splice(0).forEach((provider) => panelRegistry.remove(provider))
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
