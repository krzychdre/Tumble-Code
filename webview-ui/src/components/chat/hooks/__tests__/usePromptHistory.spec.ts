import { act, renderHook } from "@testing-library/react"
import type { ClineMessage, HistoryItem } from "@tumble-code/types"

import { usePromptHistory } from "../usePromptHistory"

type Props = Parameters<typeof usePromptHistory>[0]

const feedback = (text: string, ts: number): ClineMessage => ({ type: "say", say: "user_feedback", text, ts })

// A streamed assistant answer: the host sends a NEW clineMessages array on every
// token, with the same user prompts and a partial text row that keeps growing.
const streamingMessages = (answer: string): ClineMessage[] => [
	feedback("First prompt", 1000),
	feedback("Second prompt", 2000),
	feedback("Third prompt", 3000),
	{ type: "say", say: "text", text: answer, ts: 4000, partial: true },
]

const arrowUp = () => {
	const textarea = document.createElement("textarea")
	textarea.value = ""
	textarea.setSelectionRange(0, 0)
	return {
		key: "ArrowUp",
		currentTarget: textarea,
		preventDefault: () => {},
	} as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

const arrowDown = () => {
	const textarea = document.createElement("textarea")
	textarea.value = ""
	textarea.setSelectionRange(0, 0)
	return {
		key: "ArrowDown",
		currentTarget: textarea,
		preventDefault: () => {},
	} as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

describe("usePromptHistory", () => {
	const baseProps = (clineMessages: ClineMessage[] | undefined, inputValue = ""): Props => ({
		clineMessages,
		taskHistory: [] as HistoryItem[],
		cwd: "/test/workspace",
		inputValue,
		setInputValue: vi.fn(),
	})

	it("keeps the Up-arrow position while the model streams tokens", () => {
		const setInputValue = vi.fn()
		const { result, rerender } = renderHook((props: Props) => usePromptHistory(props), {
			initialProps: { ...baseProps(streamingMessages("H")), setInputValue },
		})

		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		expect(setInputValue).toHaveBeenLastCalledWith("Third prompt")
		expect(result.current.historyIndex).toBe(0)

		// Three more tokens arrive, each as a fresh messages array.
		for (const answer of ["He", "Hel", "Hell"]) {
			rerender({ ...baseProps(streamingMessages(answer), "Third prompt"), setInputValue })
		}

		expect(result.current.historyIndex).toBe(0)

		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		expect(setInputValue).toHaveBeenLastCalledWith("Second prompt")
	})

	it("keeps the saved draft while the model streams tokens", () => {
		const setInputValue = vi.fn()
		const { result, rerender } = renderHook((props: Props) => usePromptHistory(props), {
			initialProps: { ...baseProps(streamingMessages("H"), "my draft"), setInputValue },
		})

		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		expect(result.current.tempInput).toBe("my draft")

		rerender({ ...baseProps(streamingMessages("He"), "Third prompt"), setInputValue })

		expect(result.current.tempInput).toBe("my draft")
		act(() => {
			result.current.handleHistoryNavigation(arrowDown(), false, false)
		})
		expect(setInputValue).toHaveBeenLastCalledWith("my draft")
	})

	it("does not replace the history, nor render twice, when its content is unchanged", () => {
		let renders = 0
		const { result, rerender } = renderHook(
			(props: Props) => {
				renders++
				return usePromptHistory(props)
			},
			{ initialProps: baseProps(streamingMessages("H")) },
		)
		const before = result.current.promptHistory
		expect(before).toEqual(["Third prompt", "Second prompt", "First prompt"])

		renders = 0
		rerender(baseProps(streamingMessages("He")))

		expect(result.current.promptHistory).toBe(before)
		// One render per token: no second commit caused by copying the history into state.
		expect(renders).toBe(1)
	})

	it("picks up a new user prompt and resets the navigation", () => {
		const { result, rerender } = renderHook((props: Props) => usePromptHistory(props), {
			initialProps: baseProps(streamingMessages("H"), "draft"),
		})

		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		expect(result.current.historyIndex).toBe(0)

		rerender(baseProps([...streamingMessages("Hello"), feedback("Fourth prompt", 5000)]))

		expect(result.current.promptHistory).toEqual(["Fourth prompt", "Third prompt", "Second prompt", "First prompt"])
		expect(result.current.historyIndex).toBe(-1)
		expect(result.current.tempInput).toBe("")
	})

	it("resets the navigation when the task changes", () => {
		const { result, rerender } = renderHook((props: Props) => usePromptHistory(props), {
			initialProps: baseProps(streamingMessages("H"), "draft"),
		})

		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		expect(result.current.tempInput).toBe("draft")

		rerender(baseProps([feedback("Other task prompt", 9000)]))

		expect(result.current.promptHistory).toEqual(["Other task prompt"])
		expect(result.current.historyIndex).toBe(-1)
		expect(result.current.tempInput).toBe("")
	})

	const task = (taskText: string, workspace?: string) => ({ task: taskText, workspace }) as HistoryItem

	it.each([
		[
			"the task's own prompts, newest first, without empty ones",
			[feedback("Valid prompt", 1000), feedback("", 2000), feedback("   ", 3000), feedback("Another", 4000)],
			[task("Old task")],
			"/test/workspace",
			["Another", "Valid prompt"],
		],
		[
			"nothing in a running task without user prompts",
			[{ type: "say", say: "text", text: "Answer", ts: 1000 } as ClineMessage],
			[task("Old task")],
			"/test/workspace",
			[],
		],
		[
			"this workspace's tasks, oldest first, without a fresh task",
			[],
			[task("First", "/test/workspace"), task("Elsewhere", "/other"), task("No workspace"), task("  ")],
			"/test/workspace",
			["First", "No workspace"],
		],
		["nothing without a workspace", undefined, [task("First")], undefined, []],
	])("offers %s", (_name, clineMessages, taskHistory, cwd, expected) => {
		const { result } = renderHook(() =>
			usePromptHistory({ clineMessages, taskHistory, cwd, inputValue: "", setInputValue: vi.fn() }),
		)

		expect(result.current.promptHistory).toEqual(expected)
	})

	it("does nothing on ArrowUp with an empty history", () => {
		const setInputValue = vi.fn()
		const { result } = renderHook(() => usePromptHistory({ ...baseProps([]), setInputValue }))

		act(() => {
			expect(result.current.handleHistoryNavigation(arrowUp(), false, false)).toBe(false)
		})
		expect(setInputValue).not.toHaveBeenCalled()
	})

	it("walks back through the history and forward again", () => {
		const setInputValue = vi.fn()
		const { result } = renderHook(() => usePromptHistory({ ...baseProps(streamingMessages("H")), setInputValue }))

		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		act(() => {
			result.current.handleHistoryNavigation(arrowUp(), false, false)
		})
		act(() => {
			result.current.handleHistoryNavigation(arrowDown(), false, false)
		})

		expect(setInputValue.mock.calls).toEqual([["Third prompt"], ["Second prompt"], ["Third prompt"]])
	})
})
