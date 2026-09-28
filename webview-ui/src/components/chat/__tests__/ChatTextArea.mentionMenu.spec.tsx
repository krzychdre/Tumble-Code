// Characterization tests for the ChatTextArea mention menu (the "@" and "/" context menu) and the
// highlight layer behind the textarea. They pin the behavior that S5 moves out of ChatTextArea into
// useMentionMenu and useHighlightLayer, so the move can be checked against them.
//
// ContextMenu is replaced by a probe that records the props it receives: the menu's own rendering and
// filtering are covered by ContextMenu's specs, what matters here is what ChatTextArea feeds it and how
// ChatTextArea reacts to a selection.

import { useState } from "react"

import { defaultModeSlug } from "@roo/modes"

import { render, fireEvent, screen, act } from "@src/utils/test-utils"
import { useExtensionState, useExtensionSelector } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { ContextMenuOptionType } from "@src/utils/context-mentions"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/context/ExtensionStateContext")

const menu = vi.hoisted(() => ({ props: null as any }))

vi.mock("../ContextMenu", () => ({
	default: (props: any) => {
		menu.props = props
		return <div data-testid="menu-probe" onMouseDown={props.onMouseDown} />
	},
}))

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

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
}

// Children that still read the whole state (the indexing popover) get the same object.
const setState = (state: Record<string, unknown>) => {
	;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue(state)
	;(useExtensionSelector as ReturnType<typeof vi.fn>).mockImplementation((selector: any) => selector(state))
}

const defaultProps = {
	sendingDisabled: false,
	selectApiConfigDisabled: false,
	onSelectImages: vi.fn(),
	shouldDisableImages: false,
	placeholderText: "Type a message...",
	selectedImages: [],
	setSelectedImages: vi.fn(),
	onHeightChange: vi.fn(),
	mode: defaultModeSlug,
	modeShortcutText: "(Ctrl+. for next mode)",
}

const setInputValueSpy = vi.fn()
const setModeSpy = vi.fn()
const onSendSpy = vi.fn()

/** ChatTextArea with a real input state, like ChatView gives it. */
const Harness = ({ initial = "" }: { initial?: string }) => {
	const [value, setValue] = useState(initial)
	return (
		<ChatTextArea
			{...defaultProps}
			inputValue={value}
			setInputValue={(v) => {
				setInputValueSpy(v)
				setValue(v)
			}}
			setMode={setModeSpy}
			onSend={onSendSpy}
		/>
	)
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement

const type = (value: string, selectionStart = value.length) => {
	fireEvent.change(textbox(), { target: { value, selectionStart } })
}

const postedOfType = (type: string) => mockPostMessage.mock.calls.map((c) => c[0]).filter((m) => m.type === type)

const postFromHost = (message: Record<string, unknown>) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})
}

describe("ChatTextArea mention menu (characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		menu.props = null
		setState(baseState)
	})

	describe("opening and filtering", () => {
		it("is closed until a trigger character is typed", () => {
			render(<Harness />)
			expect(screen.queryByTestId("menu-probe")).toBeNull()

			type("hello")
			expect(screen.queryByTestId("menu-probe")).toBeNull()
		})

		it("opens on '@' with an empty query and the File row preselected", () => {
			render(<Harness />)
			type("@")

			expect(screen.getByTestId("menu-probe")).toBeInTheDocument()
			expect(menu.props.searchQuery).toBe("")
			expect(menu.props.selectedIndex).toBe(3)
			expect(menu.props.selectedType).toBeNull()
			expect(menu.props.inputValue).toBe("@")
			expect(menu.props.loading).toBe(false)
			expect(postedOfType("searchFiles")).toHaveLength(0)
		})

		it("builds the query items from opened tabs and file paths", () => {
			setState({
				...baseState,
				openedTabs: [
					{ label: "a.ts", isActive: true, path: "src/a.ts" },
					{ label: "untitled", isActive: false },
				],
				filePaths: ["src/a.ts", "src/b.ts", "lib/"],
			})
			render(<Harness />)
			type("@")

			expect(menu.props.queryItems).toEqual([
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				{ type: ContextMenuOptionType.OpenedFile, value: "/src/a.ts" },
				{ type: ContextMenuOptionType.File, value: "/src/b.ts" },
				{ type: ContextMenuOptionType.Folder, value: "/lib/" },
			])
		})

		it("passes the modes and the commands to the menu", () => {
			render(<Harness />)
			type("@")

			expect(menu.props.commands).toBe(baseState.commands)
			const slugs = menu.props.modes.map((m: { slug: string }) => m.slug)
			expect(slugs).toContain("code")
			expect(slugs).toContain("architect")
		})

		it("debounces the file search by 200 ms and sends the unescaped query", () => {
			vi.useFakeTimers()
			try {
				render(<Harness />)
				type("@fo")
				type("@my\\ fi")

				expect(menu.props.searchQuery).toBe("my\\ fi")
				expect(menu.props.selectedIndex).toBe(0)
				expect(postedOfType("searchFiles")).toHaveLength(0)

				act(() => {
					vi.advanceTimersByTime(199)
				})
				expect(postedOfType("searchFiles")).toHaveLength(0)

				act(() => {
					vi.advanceTimersByTime(1)
				})
				const sent = postedOfType("searchFiles")
				expect(sent).toHaveLength(1)
				expect(sent[0]).toEqual({ type: "searchFiles", query: "my fi", requestId: expect.any(String) })
				expect(menu.props.loading).toBe(true)
			} finally {
				vi.useRealTimers()
			}
		})

		it("shows file search results only for the latest request id", () => {
			vi.useFakeTimers()
			try {
				render(<Harness />)
				type("@fo")
				act(() => {
					vi.advanceTimersByTime(200)
				})
				const { requestId } = postedOfType("searchFiles")[0]

				postFromHost({
					type: "fileSearchResults",
					requestId: "stale",
					results: [{ path: "stale.ts", type: "file" }],
				})
				expect(menu.props.loading).toBe(false)
				expect(menu.props.dynamicSearchResults).toEqual([])

				postFromHost({
					type: "fileSearchResults",
					requestId,
					results: [{ path: "foo.ts", type: "file" }],
				})
				expect(menu.props.dynamicSearchResults).toEqual([{ path: "foo.ts", type: "file" }])
			} finally {
				vi.useRealTimers()
			}
		})

		it("opens the slash menu on '/', asks for fresh commands and preselects the first command", () => {
			render(<Harness />)
			type("/")

			expect(menu.props.searchQuery).toBe("/")
			expect(menu.props.selectedIndex).toBe(1)
			expect(postedOfType("requestCommands")).toHaveLength(1)

			type("/dep")
			expect(menu.props.searchQuery).toBe("/dep")
			expect(postedOfType("requestCommands")).toHaveLength(2)
		})

		it("closes and clears the query and results once the trigger is gone", () => {
			vi.useFakeTimers()
			try {
				render(<Harness />)
				type("@fo")
				act(() => {
					vi.advanceTimersByTime(200)
				})
				const { requestId } = postedOfType("searchFiles")[0]
				postFromHost({ type: "fileSearchResults", requestId, results: [{ path: "foo.ts", type: "file" }] })

				type("@fo bar")
				expect(screen.queryByTestId("menu-probe")).toBeNull()

				type("@")
				expect(menu.props.searchQuery).toBe("")
				expect(menu.props.dynamicSearchResults).toEqual([])
			} finally {
				vi.useRealTimers()
			}
		})

		it("asks for commits when the query looks like a hash and lists the returned commits", () => {
			render(<Harness />)
			type("@abc12")

			expect(postedOfType("searchCommits")).toContainEqual({ type: "searchCommits", query: "abc12" })

			postFromHost({
				type: "commitSearchResults",
				commits: [
					{ hash: "abc1234full", shortHash: "abc1234", subject: "Fix it", author: "Ann", date: "2026-01-02" },
				],
			})

			expect(menu.props.queryItems).toContainEqual({
				type: ContextMenuOptionType.Git,
				value: "abc1234full",
				label: "Fix it",
				description: "abc1234 by Ann on 2026-01-02",
				icon: "$(git-commit)",
			})
		})
	})

	describe("keyboard", () => {
		// "/" with two commands and the built-in modes gives:
		// 0 Commands header, 1 /setup, 2 /deploy, 3 Modes header, 4.. modes.
		it("ArrowDown and ArrowUp move over selectable rows and wrap, skipping section headers", () => {
			render(<Harness />)
			type("/")
			expect(menu.props.selectedIndex).toBe(1)

			fireEvent.keyDown(textbox(), { key: "ArrowDown" })
			expect(menu.props.selectedIndex).toBe(2)

			fireEvent.keyDown(textbox(), { key: "ArrowDown" })
			expect(menu.props.selectedIndex).toBe(4)

			fireEvent.keyDown(textbox(), { key: "ArrowUp" })
			expect(menu.props.selectedIndex).toBe(2)

			fireEvent.keyDown(textbox(), { key: "ArrowUp" })
			fireEvent.keyDown(textbox(), { key: "ArrowUp" })
			// Wrapped from /setup to the last mode row.
			const lastIndex = 3 + menu.props.modes.length
			expect(menu.props.selectedIndex).toBe(lastIndex)
		})

		it("arrow keys are consumed by the menu and do not reach the history or the send key", () => {
			render(<Harness />)
			type("/")
			const notPrevented = fireEvent.keyDown(textbox(), { key: "ArrowUp" })
			expect(notPrevented).toBe(false)
			expect(onSendSpy).not.toHaveBeenCalled()
		})

		it("Enter selects the highlighted command and does not send", () => {
			render(<Harness />)
			type("/")
			fireEvent.keyDown(textbox(), { key: "ArrowDown" })
			fireEvent.keyDown(textbox(), { key: "Enter" })

			expect(onSendSpy).not.toHaveBeenCalled()
			expect(textbox().value).toBe("/deploy ")
			expect(screen.queryByTestId("menu-probe")).toBeNull()
		})

		it("Tab selects the highlighted mode like Enter", () => {
			render(<Harness />)
			type("/")
			fireEvent.keyDown(textbox(), { key: "ArrowDown" })
			fireEvent.keyDown(textbox(), { key: "ArrowDown" })
			const slug = menu.props.modes[0].slug
			fireEvent.keyDown(textbox(), { key: "Tab" })

			expect(setModeSpy).toHaveBeenCalledWith(slug)
			expect(mockPostMessage).toHaveBeenCalledWith({ type: "mode", text: slug })
			expect(textbox().value).toBe("")
		})

		it("Escape leaves a submenu and preselects the File row, keeping the menu open", () => {
			render(<Harness />)
			type("@")
			act(() => menu.props.onSelect(ContextMenuOptionType.Folder))
			expect(menu.props.selectedType).toBe(ContextMenuOptionType.Folder)

			fireEvent.keyDown(textbox(), { key: "Escape" })
			expect(menu.props.selectedType).toBeNull()
			expect(menu.props.selectedIndex).toBe(3)
			expect(screen.getByTestId("menu-probe")).toBeInTheDocument()
		})

		it("Enter sends when the menu is closed", () => {
			render(<Harness initial="hello" />)
			fireEvent.keyDown(textbox(), { key: "Enter" })
			expect(onSendSpy).toHaveBeenCalledTimes(1)
		})
	})

	describe("selecting an option", () => {
		it("File without a value opens the file submenu", () => {
			render(<Harness />)
			type("@")
			act(() => menu.props.onSelect(ContextMenuOptionType.File))

			expect(menu.props.selectedType).toBe(ContextMenuOptionType.File)
			expect(menu.props.searchQuery).toBe("")
			expect(menu.props.selectedIndex).toBe(0)
			expect(screen.getByTestId("menu-probe")).toBeInTheDocument()
		})

		it("Git without a value opens the commit submenu and asks for commits", () => {
			render(<Harness />)
			type("@")
			mockPostMessage.mockClear()
			act(() => menu.props.onSelect(ContextMenuOptionType.Git))

			expect(menu.props.selectedType).toBe(ContextMenuOptionType.Git)
			expect(postedOfType("searchCommits")).toEqual([{ type: "searchCommits", query: "" }])
		})

		it("a file inserts the mention at the cursor, closes the menu and moves the cursor after it", () => {
			render(<Harness />)
			type("look at @sr")
			act(() => menu.props.onSelect(ContextMenuOptionType.File, "/src/b.ts"))

			expect(textbox().value).toBe("look at @/src/b.ts ")
			expect(textbox().selectionStart).toBe("look at @/src/b.ts ".length)
			expect(screen.queryByTestId("menu-probe")).toBeNull()
		})

		it("problems and terminal insert their fixed mention", () => {
			render(<Harness />)
			type("@")
			act(() => menu.props.onSelect(ContextMenuOptionType.Problems))
			expect(textbox().value).toBe("@problems ")

			type("@problems @")
			act(() => menu.props.onSelect(ContextMenuOptionType.Terminal))
			expect(textbox().value).toBe("@problems @terminal ")
		})

		it("a command replaces the input with the command and a space", () => {
			render(<Harness />)
			type("/dep")
			act(() => menu.props.onSelect(ContextMenuOptionType.Command, "deploy"))

			expect(textbox().value).toBe("/deploy ")
			expect(textbox().selectionStart).toBe(8)
			expect(setInputValueSpy.mock.calls.map((c) => c[0])).toEqual(["/dep", "", "/deploy "])
		})

		it("a mode switches the mode, clears the input and tells the extension", () => {
			render(<Harness />)
			type("/arch")
			act(() => menu.props.onSelect(ContextMenuOptionType.Mode, "architect"))

			expect(setModeSpy).toHaveBeenCalledWith("architect")
			expect(mockPostMessage).toHaveBeenCalledWith({ type: "mode", text: "architect" })
			expect(textbox().value).toBe("")
			expect(screen.queryByTestId("menu-probe")).toBeNull()
		})

		it("the no-results row does nothing", () => {
			render(<Harness />)
			type("@zz")
			setInputValueSpy.mockClear()
			act(() => menu.props.onSelect(ContextMenuOptionType.NoResults))

			expect(setInputValueSpy).not.toHaveBeenCalled()
			expect(screen.getByTestId("menu-probe")).toBeInTheDocument()
		})
	})

	describe("closing", () => {
		it("a mousedown outside the menu closes it, one inside does not", () => {
			render(<Harness />)
			type("@")

			fireEvent.mouseDown(screen.getByTestId("menu-probe"))
			expect(screen.getByTestId("menu-probe")).toBeInTheDocument()

			fireEvent.mouseDown(document.body)
			expect(screen.queryByTestId("menu-probe")).toBeNull()
		})

		it("blur closes the menu unless the mouse went down on the menu", () => {
			const { unmount } = render(<Harness />)
			type("@")
			fireEvent.blur(textbox())
			expect(screen.queryByTestId("menu-probe")).toBeNull()
			unmount()

			render(<Harness />)
			type("@")
			fireEvent.mouseDown(screen.getByTestId("menu-probe"))
			fireEvent.blur(textbox())
			expect(screen.getByTestId("menu-probe")).toBeInTheDocument()
		})
	})

	describe("backspace after a mention", () => {
		it("first backspace steps over the space, the second removes the whole mention", () => {
			render(<Harness initial="@/a.ts hello" />)
			const ta = textbox()
			ta.setSelectionRange(7, 7)
			fireEvent.mouseUp(ta)

			// Space after the mention, followed by a word: the cursor only moves.
			expect(fireEvent.keyDown(ta, { key: "Backspace" })).toBe(false)
			expect(ta.selectionStart).toBe(6)
			expect(ta.value).toBe("@/a.ts hello")

			expect(fireEvent.keyDown(ta, { key: "Backspace" })).toBe(false)
			expect(ta.value).toBe("hello")
			expect(ta.selectionStart).toBe(0)
		})

		it("a backspace that is not after a mention is left to the browser", () => {
			render(<Harness initial="plain text" />)
			const ta = textbox()
			ta.setSelectionRange(5, 5)
			fireEvent.mouseUp(ta)

			expect(fireEvent.keyDown(ta, { key: "Backspace" })).toBe(true)
			expect(ta.value).toBe("plain text")
		})
	})

	describe("host messages handled next to the menu", () => {
		it("insertTextIntoTextarea inserts the text at the cursor with separating spaces", () => {
			vi.useFakeTimers()
			try {
				render(<Harness initial="run now" />)
				const ta = textbox()
				ta.setSelectionRange(3, 3)

				postFromHost({ type: "insertTextIntoTextarea", text: "/setup" })
				expect(ta.value).toBe("run /setup  now")

				act(() => {
					vi.runAllTimers()
				})
				expect(ta.selectionStart).toBe(3 + 1 + "/setup".length + 1)
			} finally {
				vi.useRealTimers()
			}
		})
	})
})

describe("ChatTextArea highlight layer (characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setState(baseState)
	})

	it("marks mentions, escapes HTML and doubles a trailing newline", () => {
		render(<Harness initial={"see @/src/a.ts & <b>\n"} />)
		expect(screen.getByTestId("highlight-layer").innerHTML).toBe(
			'see <mark class="mention-context-textarea-highlight">@/src/a.ts</mark> &amp; &lt;b&gt;\n\n',
		)
	})

	it("marks only known slash commands and keeps a leading space outside the mark", () => {
		render(<Harness initial={"/setup now\nthen /deploy and /unknown"} />)
		expect(screen.getByTestId("highlight-layer").innerHTML).toBe(
			'<mark class="mention-context-textarea-highlight">/setup</mark> now\nthen <mark class="mention-context-textarea-highlight">/deploy</mark> and /unknown',
		)
	})

	it("follows the textarea on every change", () => {
		render(<Harness />)
		type("@problems x")
		expect(screen.getByTestId("highlight-layer").innerHTML).toBe(
			'<mark class="mention-context-textarea-highlight">@problems</mark> x',
		)
	})

	it("re-highlights when the command list arrives", () => {
		const { rerender } = render(<Harness initial="/setup" />)
		expect(screen.getByTestId("highlight-layer").innerHTML).toContain("<mark")

		setState({ ...baseState, commands: [] })
		rerender(<Harness initial="/setup" />)
		expect(screen.getByTestId("highlight-layer").innerHTML).toBe("/setup")
	})

	it("copies the textarea scroll offsets on scroll", () => {
		render(<Harness initial="text" />)
		const ta = textbox()
		ta.scrollTop = 40
		ta.scrollLeft = 7
		fireEvent.scroll(ta)

		const layer = screen.getByTestId("highlight-layer")
		expect(layer.scrollTop).toBe(40)
		expect(layer.scrollLeft).toBe(7)
	})
})
