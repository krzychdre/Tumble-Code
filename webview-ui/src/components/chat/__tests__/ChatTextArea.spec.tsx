// The composer's own handlers: prompt enhancement, drag and drop, the send
// key, the history keys and the send button. The mention menu and the
// highlight layer are covered by ChatTextArea.mentionMenu.spec.tsx, the
// toolbars by ChatTextArea.toolbar.spec.tsx, and the history content by
// hooks/__tests__/usePromptHistory.spec.ts.

import { defaultModeSlug } from "@shared/modes"

import { render, fireEvent, screen, waitFor } from "@src/utils/test-utils"
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

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

const CWD = "/test/workspace"

const baseState = {
	filePaths: [],
	openedTabs: [],
	apiConfiguration: { apiProvider: "anthropic" },
	taskHistory: [],
	clineMessages: [
		{ type: "say", say: "user_feedback", text: "First prompt", ts: 1000 },
		{ type: "say", say: "user_feedback", text: "Second prompt", ts: 2000 },
		{ type: "say", say: "user_feedback", text: "Third prompt", ts: 3000 },
	],
	cwd: CWD,
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
	modeShortcutText: "(⌘. for next mode)",
}

const renderArea = (props: Partial<typeof defaultProps> = {}) => {
	const view = render(<ChatTextArea {...defaultProps} {...props} />)
	// container, not document: react-textarea-autosize keeps one hidden
	// measuring <textarea> appended to <body> for the whole file.
	return { ...view, textarea: view.container.querySelector("textarea")! }
}

const buttonWithIcon = (container: HTMLElement, iconClass: string) =>
	Array.from(container.querySelectorAll("button")).find((b) => b.querySelector(`.${iconClass}`) !== null)

const postFromHost = (data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", { data }))

describe("ChatTextArea", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setState(baseState)
	})

	describe("prompt enhancement", () => {
		it("asks the host to enhance the input and shows the spinner meanwhile", () => {
			const { container } = renderArea({ inputValue: "Test prompt", sendingDisabled: true })
			const button = buttonWithIcon(container, "lucide-wand-sparkles")!

			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({ type: "enhancePrompt", text: "Test prompt" })
			expect(button.querySelector(".ui-progress-ring")).toBeInTheDocument()
		})

		it("sends nothing for an empty input", () => {
			const { container } = renderArea({ inputValue: "" })
			mockPostMessage.mockClear()

			fireEvent.click(buttonWithIcon(container, "lucide-wand-sparkles")!)

			expect(mockPostMessage).not.toHaveBeenCalled()
		})

		it("replaces the text through execCommand, so the edit can be undone", () => {
			const execCommand = vi.fn().mockReturnValue(true)
			Object.defineProperty(document, "execCommand", { value: execCommand, writable: true })
			const setInputValue = vi.fn()
			const { textarea } = renderArea({ inputValue: "Original prompt", setInputValue })
			textarea.select = vi.fn()

			postFromHost({ type: "enhancedPrompt", text: "Enhanced test prompt" })

			expect(textarea.select).toHaveBeenCalled()
			expect(execCommand).toHaveBeenCalledWith("insertText", false, "Enhanced test prompt")
			expect(setInputValue).not.toHaveBeenCalled()
		})

		it("falls back to setInputValue without execCommand", () => {
			Object.defineProperty(document, "execCommand", { value: undefined, writable: true })
			const setInputValue = vi.fn()
			renderArea({ inputValue: "Original prompt", setInputValue })

			postFromHost({ type: "enhancedPrompt", text: "Enhanced test prompt" })

			expect(setInputValue).toHaveBeenCalledWith("Enhanced test prompt")
		})
	})

	describe("drag and drop", () => {
		const drop = (target: HTMLElement, data: Record<string, string>, files: File[] = []) =>
			fireEvent.drop(target.querySelector(".chat-text-area")!, {
				dataTransfer: { getData: (format: string) => data[format] ?? "", files },
			})

		it.each([
			["dragged text", { text: `${CWD}/file1.js\n\n${CWD}/file2.js\n` }],
			["a dragged editor tab", { "application/vnd.code.uri-list": `${CWD}/file1.js\r\n${CWD}/file2.js` }],
		])("inserts one mention per path from %s, skipping empty lines", (_name, data) => {
			const setInputValue = vi.fn()
			const { container } = renderArea({ inputValue: "Initial text", setInputValue })

			drop(container, data)

			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Initial text")
		})

		it("does nothing for an empty drop", () => {
			const setInputValue = vi.fn()
			const { container } = renderArea({ inputValue: "Initial text", setInputValue })

			drop(container, {})

			expect(setInputValue).not.toHaveBeenCalled()
		})

		const png = () => new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" })
		const txt = () => new File(["x"], "a.txt", { type: "text/plain" })

		it("adds dropped png, jpeg and webp images and ignores other files", async () => {
			const setSelectedImages = vi.fn()
			const { container } = renderArea({ setSelectedImages })

			drop(container, {}, [png(), txt()])

			await waitFor(() => expect(setSelectedImages).toHaveBeenCalled())
			const update = setSelectedImages.mock.calls[0][0] as (prev: string[]) => string[]
			expect(update(["old"])).toEqual(["old", expect.stringMatching(/^data:image\/png;base64,/)])
		})

		it("ignores dropped images when the model takes none", async () => {
			const setSelectedImages = vi.fn()
			const { container } = renderArea({ setSelectedImages, shouldDisableImages: true })

			drop(container, {}, [png()])
			await new Promise((resolve) => setTimeout(resolve, 20))

			expect(setSelectedImages).not.toHaveBeenCalled()
		})
	})

	describe("Enter", () => {
		const press = (textarea: HTMLTextAreaElement, init: KeyboardEventInit) => {
			const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })
			fireEvent(textarea, event)
			return event.defaultPrevented
		}

		it.each([
			// [enterBehavior, modifiers, sends]
			["send", {}, true],
			["send", { shiftKey: true }, false],
			["newline", {}, false],
			["newline", { shiftKey: true }, false],
			["newline", { ctrlKey: true }, true],
			["newline", { metaKey: true }, true],
		])("with enterBehavior=%s and %o sends: %s", (enterBehavior, modifiers, sends) => {
			setState({ ...baseState, enterBehavior })
			const onSend = vi.fn()
			const { textarea } = renderArea({ onSend })

			const prevented = press(textarea, modifiers)

			expect(onSend).toHaveBeenCalledTimes(sends ? 1 : 0)
			expect(prevented).toBe(sends)
		})
	})

	describe("prompt history keys", () => {
		it.each([
			["ArrowUp at the start", 0, false, "Third prompt"],
			["Cmd+ArrowUp at the start", 0, true, "Third prompt"],
			["ArrowUp inside the text", 5, false, undefined],
			["Cmd+ArrowUp inside the text", 5, true, undefined],
		])("%s recalls: %s", (_name, cursor, metaKey, recalled) => {
			const setInputValue = vi.fn()
			const { textarea } = renderArea({ inputValue: "Some text here", setInputValue })
			textarea.setSelectionRange(cursor, cursor)

			fireEvent.keyDown(textarea, { key: "ArrowUp", metaKey })

			expect(setInputValue.mock.calls).toEqual(recalled ? [[recalled]] : [])
		})

		it("ArrowDown from the newest prompt brings back the draft", () => {
			const setInputValue = vi.fn()
			const { textarea } = renderArea({ inputValue: "Current input", setInputValue })
			textarea.setSelectionRange(0, 0)

			fireEvent.keyDown(textarea, { key: "ArrowUp" })
			fireEvent.keyDown(textarea, { key: "ArrowDown" })

			expect(setInputValue.mock.calls).toEqual([["Third prompt"], ["Current input"]])
		})

		it.each([
			["typing", (textarea: HTMLTextAreaElement) => fireEvent.change(textarea, { target: { value: "x" } })],
			["sending", (textarea: HTMLTextAreaElement) => fireEvent.keyDown(textarea, { key: "Enter" })],
		])("%s starts the next recall from the newest prompt again", (_name, act) => {
			const setInputValue = vi.fn()
			const { textarea } = renderArea({ setInputValue })

			fireEvent.keyDown(textarea, { key: "ArrowUp" })
			act(textarea)
			textarea.value = ""
			textarea.setSelectionRange(0, 0)
			fireEvent.keyDown(textarea, { key: "ArrowUp" })

			expect(setInputValue).toHaveBeenLastCalledWith("Third prompt")
		})
	})

	describe("send button", () => {
		it.each([
			["text", "Some text", [], true],
			["images", "", ["data:image/png;base64,a"], true],
			["text and images", "Some text", ["data:image/png;base64,a"], true],
			["nothing", "", [], false],
		])("with %s is shown: %s", (_name, inputValue, selectedImages, shown) => {
			const { container } = renderArea({ inputValue, selectedImages })

			expect(buttonWithIcon(container, "lucide-send-horizontal")).toHaveClass(shown ? "opacity-100" : "opacity-0")
		})
	})

	it("the API config selector follows selectApiConfigDisabled, not sendingDisabled", () => {
		const { unmount } = renderArea({ sendingDisabled: true, selectApiConfigDisabled: false })
		expect(screen.getByTestId("dropdown-trigger")).not.toHaveAttribute("disabled")
		unmount()

		renderArea({ sendingDisabled: false, selectApiConfigDisabled: true })
		expect(screen.getByTestId("dropdown-trigger")).toHaveAttribute("disabled")
	})

	it("switches the mode from the slash menu with the setMode prop of the latest render", () => {
		const firstSetMode = vi.fn()
		const latestSetMode = vi.fn()
		const { rerender, textarea } = renderArea({ setMode: firstSetMode })
		fireEvent.change(textarea, { target: { value: "/", selectionStart: 1 } })

		// A parent render passes a new setMode while the menu is open.
		rerender(<ChatTextArea {...defaultProps} setMode={latestSetMode} />)
		fireEvent.click(screen.getByText("/architect"))

		expect(firstSetMode).not.toHaveBeenCalled()
		expect(latestSetMode).toHaveBeenCalledWith("architect")
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mode", text: "architect" })
	})
})
