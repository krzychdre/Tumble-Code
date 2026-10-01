// Characterization tests for the ChatTextArea toolbars: the selector row under the textarea (mode, API
// configuration, auto-approve, indexing status, cloud account) and the action buttons inside it
// (images, enhance or cancel, queue, send or stop). They pin the behavior that S5 moves into
// ComposerToolbar and ComposerActionButtons.
//
// The selectors are replaced by probes that record their props: their own behavior has its own specs,
// what matters here is what ChatTextArea passes them and what it does with their callbacks.

import { defaultModeSlug } from "@roo/modes"

import { render, fireEvent, screen, act } from "@src/utils/test-utils"
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
vi.mock("@src/context/ExtensionStateContext")

const probes = vi.hoisted(() => ({
	mode: null as any,
	apiConfig: null as any,
	autoApprove: null as any,
}))

vi.mock("../ModeSelector", () => ({
	ModeSelector: (props: any) => {
		probes.mode = props
		return <div data-testid="mode-selector-probe" />
	},
}))

vi.mock("../ApiConfigSelector", () => ({
	ApiConfigSelector: (props: any) => {
		probes.apiConfig = props
		return <div data-testid="api-config-selector-probe" />
	},
}))

vi.mock("../AutoApproveDropdown", () => ({
	AutoApproveDropdown: (props: any) => {
		probes.autoApprove = props
		return <div data-testid="auto-approve-probe" />
	},
}))

vi.mock("../IndexingStatusBadge", () => ({
	IndexingStatusBadge: () => <div data-testid="indexing-badge-probe" />,
}))

vi.mock("../../cloud/CloudAccountSwitcher", () => ({
	CloudAccountSwitcher: () => <div data-testid="cloud-switcher-probe" />,
}))

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

const togglePinnedApiConfig = vi.fn()

const baseState = {
	filePaths: [],
	openedTabs: [],
	taskHistory: [],
	clineMessages: [],
	cwd: "/test/workspace",
	listApiConfigMeta: [
		{ id: "id-default", name: "Default", modelId: "claude" },
		{ id: "id-fast", name: "Fast", modelId: "glm" },
	],
	currentApiConfigName: "Fast",
	pinnedApiConfigs: { "id-default": true },
	togglePinnedApiConfig,
	lockApiConfigAcrossModes: true,
	modeApiConfigs: { code: "id-fast" },
	customModes: [
		{ slug: "reviewer", name: "Reviewer", roleDefinition: "Reviews", groups: ["read"], source: "global" },
	],
	customModePrompts: { code: { roleDefinition: "custom" } },
}

const setState = (state: Record<string, unknown>) => {
	;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue(state)
	;(useExtensionSelector as ReturnType<typeof vi.fn>).mockImplementation((selector: any) => selector(state))
}

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
	modeShortcutText: "(Ctrl+. for next mode)",
}

const buttonWithIcon = (container: HTMLElement, iconClass: string) =>
	Array.from(container.querySelectorAll("button")).find((b) => b.querySelector(`.${iconClass}`) !== null)

describe("ChatTextArea selector row (characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		probes.mode = null
		probes.apiConfig = null
		probes.autoApprove = null
		setState(baseState)
	})

	it("passes the mode, the shortcut text and the custom modes to the mode selector", () => {
		render(<ChatTextArea {...defaultProps} mode="architect" />)

		expect(probes.mode.value).toBe("architect")
		expect(probes.mode.title).toBe("chat:selectMode")
		expect(probes.mode.modeShortcutText).toBe("(Ctrl+. for next mode)")
		expect(probes.mode.customModes).toBe(baseState.customModes)
		expect(probes.mode.customModePrompts).toBe(baseState.customModePrompts)
		expect(probes.mode.triggerClassName).toBe("text-ellipsis overflow-hidden flex-shrink-0")
	})

	it("a mode change calls setMode and tells the extension", () => {
		const setMode = vi.fn()
		render(<ChatTextArea {...defaultProps} setMode={setMode} />)
		act(() => probes.mode.onChange("debug"))

		expect(setMode).toHaveBeenCalledWith("debug")
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mode", text: "debug" })
	})

	it("passes the current API configuration and the per-mode settings to the API config selector", () => {
		render(<ChatTextArea {...defaultProps} selectApiConfigDisabled={true} />)

		const p = probes.apiConfig
		expect(p.value).toBe("id-fast")
		expect(p.displayName).toBe("Fast")
		expect(p.disabled).toBe(true)
		expect(p.title).toBe("chat:selectApiConfig")
		expect(p.listApiConfigMeta).toBe(baseState.listApiConfigMeta)
		expect(p.pinnedApiConfigs).toBe(baseState.pinnedApiConfigs)
		expect(p.togglePinnedApiConfig).toBe(togglePinnedApiConfig)
		expect(p.lockApiConfigAcrossModes).toBe(true)
		expect(p.modeApiConfigs).toBe(baseState.modeApiConfigs)
		expect(p.triggerClassName).toBe("min-w-[28px] text-ellipsis overflow-hidden flex-shrink")
		expect(p.availableModes).toContainEqual({ slug: "code", name: expect.any(String) })
		expect(p.availableModes).toContainEqual({ slug: "reviewer", name: "Reviewer" })
	})

	it("falls back to an empty id, name and list when nothing is configured", () => {
		setState({
			...baseState,
			listApiConfigMeta: undefined,
			currentApiConfigName: undefined,
			lockApiConfigAcrossModes: undefined,
		})
		render(<ChatTextArea {...defaultProps} />)

		expect(probes.apiConfig.value).toBe("")
		expect(probes.apiConfig.displayName).toBe("")
		expect(probes.apiConfig.listApiConfigMeta).toEqual([])
		expect(probes.apiConfig.lockApiConfigAcrossModes).toBe(false)
	})

	it("an API config change and the lock toggle post their messages", () => {
		render(<ChatTextArea {...defaultProps} />)

		act(() => probes.apiConfig.onChange("id-default"))
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "loadApiConfigurationById", text: "id-default" })

		act(() => probes.apiConfig.onToggleLockApiConfig())
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "lockApiConfigAcrossModes", bool: false })
	})

	it("renders the auto-approve dropdown with its trigger class", () => {
		render(<ChatTextArea {...defaultProps} />)
		expect(probes.autoApprove.triggerClassName).toBe("min-w-[28px] text-ellipsis overflow-hidden flex-shrink")
	})

	it("shows the indexing badge outside edit mode and the cloud switcher only when signed in", () => {
		const { unmount } = render(<ChatTextArea {...defaultProps} />)
		expect(screen.getByTestId("indexing-badge-probe")).toBeInTheDocument()
		expect(screen.queryByTestId("cloud-switcher-probe")).toBeNull()
		expect(screen.getByTestId("indexing-badge-probe").parentElement).toHaveClass("pr-2")
		unmount()

		setState({ ...baseState, cloudUserInfo: { name: "Ann" } })
		render(<ChatTextArea {...defaultProps} />)
		expect(screen.getByTestId("cloud-switcher-probe")).toBeInTheDocument()
		expect(screen.getByTestId("indexing-badge-probe").parentElement).not.toHaveClass("pr-2")
	})

	it("hides the indexing badge and the cloud switcher in edit mode", () => {
		setState({ ...baseState, cloudUserInfo: { name: "Ann" } })
		render(<ChatTextArea {...defaultProps} isEditMode={true} />)

		expect(screen.queryByTestId("indexing-badge-probe")).toBeNull()
		expect(screen.queryByTestId("cloud-switcher-probe")).toBeNull()
		expect(screen.getByTestId("mode-selector-probe")).toBeInTheDocument()
	})
})

describe("ChatTextArea action buttons (characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setState(baseState)
	})

	it("the image button calls onSelectImages, and is disabled when images are not allowed", () => {
		const onSelectImages = vi.fn()
		const { container, unmount } = render(<ChatTextArea {...defaultProps} onSelectImages={onSelectImages} />)
		const button = buttonWithIcon(container, "lucide-image")!
		expect(button).toHaveAttribute("aria-label", "chat:addImages")
		fireEvent.click(button)
		expect(onSelectImages).toHaveBeenCalledTimes(1)
		unmount()

		const disabled = render(
			<ChatTextArea {...defaultProps} onSelectImages={onSelectImages} shouldDisableImages={true} />,
		)
		const disabledButton = buttonWithIcon(disabled.container, "lucide-image")!
		expect(disabledButton).toBeDisabled()
		expect(disabledButton).toHaveClass("opacity-40", "pointer-events-none", "cursor-not-allowed")
	})

	it("the enhance button is visible only with content", () => {
		const { container, rerender } = render(<ChatTextArea {...defaultProps} inputValue="" />)
		expect(buttonWithIcon(container, "lucide-wand-sparkles")).toHaveClass("opacity-0")

		rerender(<ChatTextArea {...defaultProps} inputValue="hi" />)
		expect(buttonWithIcon(container, "lucide-wand-sparkles")).toHaveClass("opacity-50", "pointer-events-auto")
	})

	it("edit mode shows a cancel button instead of enhance, and Escape cancels", () => {
		const onCancel = vi.fn()
		const { container } = render(<ChatTextArea {...defaultProps} isEditMode={true} onCancel={onCancel} />)

		expect(buttonWithIcon(container, "lucide-wand-sparkles")).toBeUndefined()
		const cancel = buttonWithIcon(container, "lucide-x")!
		expect(cancel).toHaveAttribute("aria-label", "chat:cancel.title")
		fireEvent.click(cancel)
		expect(onCancel).toHaveBeenCalledTimes(1)

		expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })).toBe(false)
		expect(onCancel).toHaveBeenCalledTimes(2)
	})

	it("Escape outside edit mode does not cancel", () => {
		const onCancel = vi.fn()
		render(<ChatTextArea {...defaultProps} onCancel={onCancel} />)
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
		expect(onCancel).not.toHaveBeenCalled()
	})

	it("the queue button appears while the task is busy with content and queues the message", () => {
		const onEnqueueMessage = vi.fn()
		const { container, rerender } = render(
			<ChatTextArea {...defaultProps} isTaskBusy={true} inputValue="" onEnqueueMessage={onEnqueueMessage} />,
		)
		expect(buttonWithIcon(container, "lucide-list-end")).toBeUndefined()

		rerender(
			<ChatTextArea {...defaultProps} isTaskBusy={true} inputValue="next" onEnqueueMessage={onEnqueueMessage} />,
		)
		const queue = buttonWithIcon(container, "lucide-list-end")!
		expect(queue).toHaveAttribute("aria-label", "chat:enqueueMessage")
		fireEvent.click(queue)
		expect(onEnqueueMessage).toHaveBeenCalledTimes(1)

		rerender(
			<ChatTextArea
				{...defaultProps}
				isTaskBusy={true}
				isEditMode={true}
				inputValue="next"
				onEnqueueMessage={onEnqueueMessage}
			/>,
		)
		expect(buttonWithIcon(container, "lucide-list-end")).toBeUndefined()
	})

	it("while the task is busy the send button becomes a stop button", () => {
		const onStop = vi.fn()
		const onSend = vi.fn()
		const { container } = render(
			<ChatTextArea {...defaultProps} isTaskBusy={true} onStop={onStop} onSend={onSend} />,
		)

		expect(buttonWithIcon(container, "lucide-send-horizontal")).toBeUndefined()
		const stop = buttonWithIcon(container, "lucide-square")!
		expect(stop).toHaveAttribute("aria-label", "chat:stop.title")
		expect(stop).toHaveClass("opacity-100", "bg-vscode-button-background")
		fireEvent.click(stop)
		expect(onStop).toHaveBeenCalledTimes(1)
		expect(onSend).not.toHaveBeenCalled()
	})

	it("the send button sends and names the key that sends", () => {
		const onSend = vi.fn()
		const { container, unmount } = render(<ChatTextArea {...defaultProps} inputValue="go" onSend={onSend} />)
		const send = buttonWithIcon(container, "lucide-send-horizontal")!
		expect(send).toHaveAttribute("aria-label", "chat:pressToSend")
		fireEvent.click(send)
		expect(onSend).toHaveBeenCalledTimes(1)
		unmount()

		// Edit mode keeps the send button visible even without content.
		const edit = render(<ChatTextArea {...defaultProps} isEditMode={true} inputValue="" />)
		expect(buttonWithIcon(edit.container, "lucide-send-horizontal")).toHaveClass("opacity-100")
	})

	it("the placeholder hint mentions images only when images are allowed", () => {
		const { container, rerender } = render(<ChatTextArea {...defaultProps} />)
		expect(container.textContent).toContain("(chat:addContext, chat:dragFilesImages)")

		rerender(<ChatTextArea {...defaultProps} shouldDisableImages={true} />)
		expect(container.textContent).toContain("(chat:addContext, chat:dragFiles)")

		rerender(<ChatTextArea {...defaultProps} inputValue="x" />)
		expect(container.textContent).not.toContain("chat:addContext")
	})
})
