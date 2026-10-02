import * as vscode from "vscode"

import { TelemetryService } from "@tumble-code/telemetry"

import { ClineProvider } from "../../core/webview/ClineProvider"
import { OrganizationAllowListViolationError } from "../../utils/errors"
import { runPromptAction } from "../runPromptAction"

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn() },
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn() } },
}))

vi.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: { getInstance: vi.fn() },
}))

vi.mock("../../shared/support-prompt", () => ({
	supportPrompt: { create: vi.fn((type: string) => `PROMPT(${type})`) },
}))

function mockProvider() {
	const provider = {
		getState: vi.fn().mockResolvedValue({ customSupportPrompts: {} }),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		createTask: vi.fn().mockResolvedValue(undefined),
	}
	vi.mocked(ClineProvider.getInstance).mockResolvedValue(provider as any)
	return provider
}

describe("runPromptAction", () => {
	beforeEach(() => vi.clearAllMocks())

	it.each([
		["addToContext", "ADD_TO_CONTEXT"],
		["terminalAddToContext", "TERMINAL_ADD_TO_CONTEXT"],
	] as const)("%s puts the prompt into the chat box instead of starting a task", async (command, promptType) => {
		const provider = mockProvider()

		await runPromptAction(command, promptType, {})

		expect(TelemetryService.instance.capture).toHaveBeenCalledWith(expect.anything(), { actionType: promptType })
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "setChatBoxMessage",
			text: `PROMPT(${promptType})\n\n`,
		})
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "action", action: "focusInput" })
		expect(provider.createTask).not.toHaveBeenCalled()
	})

	it.each([
		["fixCode", "FIX"],
		["newTask", "NEW_TASK"],
		["terminalFixCommand", "TERMINAL_FIX"],
	] as const)("%s starts a task with the prompt", async (command, promptType) => {
		const provider = mockProvider()

		await runPromptAction(command, promptType, {})

		expect(provider.createTask).toHaveBeenCalledWith(`PROMPT(${promptType})`)
	})

	// Code actions used to rethrow this error silently; only terminal actions showed it.
	it.each([
		["fixCode", "FIX"],
		["terminalFixCommand", "TERMINAL_FIX"],
	] as const)("%s shows an organization allow-list violation and rethrows it", async (command, promptType) => {
		const provider = mockProvider()
		const error = new OrganizationAllowListViolationError("Provider not allowed")
		provider.createTask.mockRejectedValue(error)

		await expect(runPromptAction(command, promptType, {})).rejects.toBe(error)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Provider not allowed")
	})

	it("rethrows other errors without showing them", async () => {
		const provider = mockProvider()
		provider.createTask.mockRejectedValue(new Error("boom"))

		await expect(runPromptAction("explainCode", "EXPLAIN", {})).rejects.toThrow("boom")
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it("does nothing without a visible provider", async () => {
		vi.mocked(ClineProvider.getInstance).mockResolvedValue(undefined)

		await expect(runPromptAction("fixCode", "FIX", {})).resolves.toBeUndefined()
	})
})
