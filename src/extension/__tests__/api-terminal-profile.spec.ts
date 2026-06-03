import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"

import { API } from "../api"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { Terminal } from "../../integrations/terminal/Terminal"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"

vi.mock("vscode")
vi.mock("../../core/webview/ClineProvider")

vi.mock("@roo-code/ipc", () => ({
	IpcServer: class {},
}))

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
