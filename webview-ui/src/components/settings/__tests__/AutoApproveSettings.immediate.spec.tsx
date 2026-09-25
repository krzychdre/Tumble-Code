// Characterization (WEB-3): the Auto-Approve section writes some settings to
// the host the moment they change, outside the Save buffer. The command
// lists are also kept in the Save buffer (setCachedStateField), so the next
// Save sends them again; the mode goes to the host and the live context only.
import { render, screen, fireEvent } from "@/utils/test-utils"

import { AutoApproveSettings } from "../AutoApproveSettings"

const { mockPostMessage, mockSetAutoApprovalMode, mockSetAutoApprovalEnabled, extensionState } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
	mockSetAutoApprovalMode: vi.fn(),
	mockSetAutoApprovalEnabled: vi.fn(),
	extensionState: { current: {} as Record<string, unknown> },
}))

vi.mock("@/utils/vscode", () => ({ vscode: { postMessage: mockPostMessage } }))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState.current,
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState.current,
}))

const renderSection = (props: Partial<React.ComponentProps<typeof AutoApproveSettings>> = {}) => {
	const setCachedStateField = vi.fn()
	render(
		<AutoApproveSettings
			alwaysAllowExecute={true}
			allowedCommands={["git status", "ls"]}
			deniedCommands={["rm -rf"]}
			setCachedStateField={setCachedStateField}
			{...props}
		/>,
	)
	return { setCachedStateField }
}

describe("AutoApproveSettings immediate writes (WEB-3)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		extensionState.current = {
			autoApprovalEnabled: false,
			autoApprovalMode: "default",
			setAutoApprovalEnabled: mockSetAutoApprovalEnabled,
			setAutoApprovalMode: mockSetAutoApprovalMode,
		}
	})

	it("posts the allowed command list as soon as a command is added", () => {
		const { setCachedStateField } = renderSection()

		fireEvent.change(screen.getByTestId("command-input"), { target: { value: "npm test" } })
		fireEvent.click(screen.getByTestId("add-command-button"))

		const commands = ["git status", "ls", "npm test"]
		expect(setCachedStateField).toHaveBeenCalledWith("allowedCommands", commands)
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: { allowedCommands: commands },
		})
	})

	it("posts the allowed command list as soon as a command is removed", () => {
		const { setCachedStateField } = renderSection()

		fireEvent.click(screen.getByTestId("remove-command-0"))

		expect(setCachedStateField).toHaveBeenCalledWith("allowedCommands", ["ls"])
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: { allowedCommands: ["ls"] },
		})
	})

	it("posts the denied command list as soon as a command is added or removed", () => {
		const { setCachedStateField } = renderSection()

		fireEvent.change(screen.getByTestId("denied-command-input"), { target: { value: "sudo" } })
		fireEvent.click(screen.getByTestId("add-denied-command-button"))
		fireEvent.click(screen.getByTestId("remove-denied-command-0"))

		expect(setCachedStateField).toHaveBeenNthCalledWith(1, "deniedCommands", ["rm -rf", "sudo"])
		expect(setCachedStateField).toHaveBeenNthCalledWith(2, "deniedCommands", [])
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "updateSettings", updatedSettings: { deniedCommands: ["rm -rf", "sudo"] } },
			{ type: "updateSettings", updatedSettings: { deniedCommands: [] } },
		])
	})

	it("does not post a duplicate command", () => {
		const { setCachedStateField } = renderSection()

		fireEvent.change(screen.getByTestId("command-input"), { target: { value: "ls" } })
		fireEvent.click(screen.getByTestId("add-command-button"))

		expect(setCachedStateField).not.toHaveBeenCalled()
		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	it("posts the approval mode immediately and enables auto-approval for a non-default mode", () => {
		const { setCachedStateField } = renderSection()

		fireEvent.click(screen.getByTestId("auto-approve-mode-bypass"))

		expect(mockSetAutoApprovalMode).toHaveBeenCalledWith("bypass")
		expect(mockSetAutoApprovalEnabled).toHaveBeenCalledWith(true)
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "updateSettings", updatedSettings: { autoApprovalMode: "bypass" } },
			{ type: "autoApprovalEnabled", bool: true },
		])
		// The mode is not part of the Save buffer.
		expect(setCachedStateField).not.toHaveBeenCalled()
	})

	it("does not touch auto-approval when switching back to the default mode", () => {
		extensionState.current = { ...extensionState.current, autoApprovalMode: "bypass", autoApprovalEnabled: true }
		renderSection()

		fireEvent.click(screen.getByTestId("auto-approve-mode-default"))

		expect(mockSetAutoApprovalEnabled).not.toHaveBeenCalled()
		expect(mockPostMessage.mock.calls.map(([message]) => message)).toEqual([
			{ type: "updateSettings", updatedSettings: { autoApprovalMode: "default" } },
		])
	})
})
