import { defaultModeSlug } from "@shared/modes"

import { render, fireEvent, screen } from "@src/utils/test-utils"
import { useExtensionState, useExtensionSelector } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/utils/path-mentions", () => ({
	convertToMentionPath: vi.fn((path: string) => path),
}))

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

describe("ChatTextArea - lockApiConfigAcrossModes toggle", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: vi.fn(),
		onSend: vi.fn(),
		sendingDisabled: false,
		selectApiConfigDisabled: false,
		onSelectImages: vi.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [] as string[],
		setSelectedImages: vi.fn(),
		onHeightChange: vi.fn(),
		mode: defaultModeSlug,
		setMode: vi.fn(),
		modeShortcutText: "(⌘. for next mode)",
	}

	const defaultState = {
		filePaths: [],
		openedTabs: [],
		apiConfiguration: { apiProvider: "anthropic" },
		taskHistory: [],
		cwd: "/test/workspace",
		listApiConfigMeta: [{ id: "default", name: "Default", modelId: "claude-3" }],
		currentApiConfigName: "Default",
		pinnedApiConfigs: {},
		togglePinnedApiConfig: vi.fn(),
	}

	// The toggle lives in ApiConfigSelector's popover; ComposerToolbar posts the flipped value.
	it.each([
		[false, "chat:lockApiConfigAcrossModes", "text-vscode-descriptionForeground", true],
		[undefined, "chat:lockApiConfigAcrossModes", "text-vscode-descriptionForeground", true],
		[true, "chat:unlockApiConfigAcrossModes", "text-vscode-focusBorder", false],
	])("with lockApiConfigAcrossModes=%s shows %s and posts bool=%s", (locked, label, colour, posted) => {
		const state = { ...defaultState, lockApiConfigAcrossModes: locked }
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue(state)
		;(useExtensionSelector as ReturnType<typeof vi.fn>).mockImplementation((selector: any) => selector(state))
		render(<ChatTextArea {...defaultProps} />)
		mockPostMessage.mockClear()

		fireEvent.click(screen.getByTestId("dropdown-trigger"))
		const button = screen.getByRole("button", { name: label })
		fireEvent.click(button)

		expect(button).toHaveClass(colour)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "lockApiConfigAcrossModes", bool: posted })
	})
})
