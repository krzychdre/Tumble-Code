// §2.5 (ai_plans/2026-09-27_ui-modernization.md): the composer's single focus
// outline, textarea aria-label, and the ContextMenu's listbox semantics
// (role="listbox", aria-activedescendant, options with ids).

import { useState } from "react"
import { render, screen, fireEvent } from "@src/utils/test-utils"
import { useExtensionState, useExtensionSelector } from "@src/context/ExtensionStateContext"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/context/ExtensionStateContext")

const baseState = {
	filePaths: [] as string[],
	openedTabs: [] as Array<{ label: string; isActive: boolean; path?: string }>,
	taskHistory: [],
	clineMessages: [],
	cwd: "/test/workspace",
	commands: [
		{ name: "setup", source: "project", description: "Setup the project" },
		{ name: "deploy", source: "global", description: "Deploy the application" },
	],
	customModes: [],
	enterBehavior: "send",
}

const defaultProps = {
	sendingDisabled: false,
	selectApiConfigDisabled: false,
	placeholderText: "Type your task here...",
	selectedImages: [] as string[],
	setSelectedImages: vi.fn(),
	onSelectImages: vi.fn(),
	shouldDisableImages: false,
	mode: "code" as const,
	modeShortcutText: "Ctrl + . for next mode",
}

/** ChatTextArea with a real input state, like ChatView gives it. */
const Harness = ({ initial = "" }: { initial?: string }) => {
	const [value, setValue] = useState(initial)
	return (
		<ChatTextArea
			{...defaultProps}
			inputValue={value}
			setInputValue={setValue}
			setMode={vi.fn()}
			onSend={vi.fn()}
		/>
	)
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement

const type = (value: string, selectionStart = value.length) => {
	fireEvent.change(textbox(), { target: { value, selectionStart } })
}

describe("ChatTextArea composer accessibility (§2.5)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(useExtensionState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(baseState)
		;(useExtensionSelector as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(selector: (s: typeof baseState) => unknown) => selector(baseState),
		)
	})

	it("the textarea has an aria-label", () => {
		render(<Harness />)
		expect(textbox()).toHaveAttribute("aria-label", defaultProps.placeholderText)
	})

	it("shows one focus outline on focus: a single ring class, no double border+outline", () => {
		render(<Harness />)
		fireEvent.focus(textbox())

		// The focused composer must not combine a visible accent border
		// with the outline (§2.5: "today border and outline double up").
		expect(textbox().className).toContain("outline-frame-accent")
		expect(textbox().className).toContain("border-transparent")
		expect(textbox().className).not.toContain("border-frame-accent")
	})

	it("keeps a visible border when the composer is not focused", () => {
		render(<Harness />)
		fireEvent.blur(textbox())

		// Many themes have a transparent input border, so the idle composer
		// would have no outline at all against the panel background.
		expect(textbox().className).toContain("border-composer-idle-border")
		expect(textbox().className).not.toContain("border-transparent")
	})

	it("the @ mention menu is a listbox whose active option follows the keyboard", () => {
		const { container } = render(<Harness />)
		type("@")
		const menu = screen.getByRole("listbox")
		const activeOption = () =>
			container.querySelector(`#${CSS.escape(menu.getAttribute("aria-activedescendant")!)}`)

		for (const option of menu.querySelectorAll('[role="option"]')) {
			expect(option.id).toMatch(/^context-menu-option-/)
		}
		const before = activeOption()
		expect(before).toHaveAttribute("aria-selected", "true")

		fireEvent.keyDown(textbox(), { key: "ArrowDown" })

		expect(activeOption()).not.toBe(before)
		expect(activeOption()).toHaveAttribute("aria-selected", "true")
	})
})
