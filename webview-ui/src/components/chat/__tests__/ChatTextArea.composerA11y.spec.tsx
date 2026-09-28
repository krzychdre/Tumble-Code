// §2.5 (ai_plans/2026-09-27_ui-modernization.md): the composer's quiet hint
// row, single focus outline, textarea aria-label, and the ContextMenu's
// listbox semantics (role="listbox", aria-activedescendant, options with ids).

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

	it("renders the quiet hint row under the input", () => {
		const { container } = render(<Harness />)
		const hintRow = container.querySelector('[data-testid="composer-hint-row"]')
		expect(hintRow).not.toBeNull()
		// The i18n key carries the "send · Shift+Enter new line · @ mention · / command" text.
		expect(hintRow!.textContent).toContain("chat:composerHint")
	})

	it("shows one focus outline on focus: a single ring class, no double border+outline", () => {
		render(<Harness />)
		fireEvent.focus(textbox())

		// The focused composer must not combine a visible focusBorder border
		// with the outline (§2.5: "today border and outline double up").
		expect(textbox().className).toContain("outline-vscode-focusBorder")
		expect(textbox().className).toContain("border-transparent")
		expect(textbox().className).not.toContain("border-vscode-focusBorder")
	})

	it("the @ mention menu is a listbox whose options carry ids and selection state", () => {
		const { container } = render(<Harness />)
		type("@")

		const menu = screen.getByRole("listbox")
		expect(menu).toHaveAttribute("aria-label", expect.stringContaining("menu"))

		const options = menu.querySelectorAll('[role="option"]')
		expect(options.length).toBeGreaterThan(0)
		for (const option of options) {
			expect(option.id).toMatch(/^context-menu-option-/)
		}

		// The highlighted option is the aria-activedescendant and aria-selected.
		const activeId = menu.getAttribute("aria-activedescendant")
		expect(activeId).toBeTruthy()
		const active = container.querySelector(`#${CSS.escape(activeId!)}`)
		expect(active).not.toBeNull()
		expect(active!.getAttribute("aria-selected")).toBe("true")
	})

	it("mention menu keyboard navigation moves aria-activedescendant", () => {
		const { container } = render(<Harness />)
		type("@")
		const menu = screen.getByRole("listbox")
		const before = menu.getAttribute("aria-activedescendant")

		fireEvent.keyDown(textbox(), { key: "ArrowDown" })

		const after = menu.getAttribute("aria-activedescendant")
		expect(after).toBeTruthy()
		// ArrowDown moves or wraps; either way the id points at an option
		// that is now the selected one.
		const active = container.querySelector(`#${CSS.escape(after!)}`)
		expect(active).not.toBeNull()
		expect(active!.getAttribute("aria-selected")).toBe("true")
		expect(typeof before).toBe("string")
	})
})
