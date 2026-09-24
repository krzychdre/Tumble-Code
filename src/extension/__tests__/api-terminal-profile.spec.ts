import { EventEmitter } from "events"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"

import { RooCodeEventName } from "@roo-code/types"

import { API } from "../api"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { Terminal } from "../../integrations/terminal/Terminal"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"

vi.mock("vscode")
vi.mock("../../core/webview/ClineProvider")

describe("API - terminal profile", () => {
	let api: API

	beforeEach(() => {
		const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		const provider = {
			context: {} as vscode.ExtensionContext,
			on: vi.fn(),
		} as unknown as ClineProvider

		Terminal.setTerminalProfile(undefined)
		api = new API(outputChannel, provider)
	})

	afterEach(() => {
		Terminal.setTerminalProfile(undefined)
		vi.restoreAllMocks()
	})

	it("closes idle terminals only when the normalized profile changes", () => {
		const closeIdleTerminalsSpy = vi.spyOn(TerminalRegistry, "closeIdleTerminals").mockImplementation(() => {})

		api.setTerminalProfile(" Git Bash ")
		api.setTerminalProfile("Git Bash")

		expect(Terminal.getTerminalProfile()).toBe("Git Bash")
		expect(closeIdleTerminalsSpy).toHaveBeenCalledTimes(1)
	})
})

describe("API - events without the removed IPC server", () => {
	it("forwards task lifecycle events to listeners of the public API", () => {
		let onTaskCreated: ((task: EventEmitter) => void) | undefined
		const provider = {
			context: {} as vscode.ExtensionContext,
			on: vi.fn((event: string, listener: (task: EventEmitter) => void) => {
				if (event === RooCodeEventName.TaskCreated) {
					onTaskCreated = listener
				}
			}),
		} as unknown as ClineProvider

		const api = new API({ appendLine: vi.fn() } as unknown as vscode.OutputChannel, provider)
		const created = vi.fn()
		const started = vi.fn()
		api.on(RooCodeEventName.TaskCreated, created)
		api.on(RooCodeEventName.TaskStarted, started)

		const task = Object.assign(new EventEmitter(), { taskId: "task-1" })
		onTaskCreated?.(task)
		task.emit(RooCodeEventName.TaskStarted)

		expect(created).toHaveBeenCalledWith("task-1")
		expect(started).toHaveBeenCalledWith("task-1")
	})
})
