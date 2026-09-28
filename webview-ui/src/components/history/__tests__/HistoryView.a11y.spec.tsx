// §2.9 (ai_plans/2026-09-27_ui-modernization.md): history rows are real
// <button>s (focusable, Enter opens), day grouping coexists with the
// parent-child trees, empty states render, timestamps use tabular numerals.
//
// Virtuoso is mocked to render every row (jsdom has no layout), so the
// day-header/group interleaving below it is real HistoryView output.

import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"

import { useExtensionState, useExtensionSelector } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import HistoryView from "../HistoryView"
import TaskItem from "../TaskItem"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/context/ExtensionStateContext")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({ data, itemContent }: any) {
		return (
			<div data-testid="virtuoso-container">
				<div data-testid="virtuoso-item-list">
					{data.map((item: any, index: number) => (
						<div key={item.key ?? item.id ?? index}>{itemContent(index, item)}</div>
					))}
				</div>
			</div>
		)
	},
}))

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

const now = Date.now()
const DAY = 86400000

const task = (id: string, ts: number, extra: Record<string, unknown> = {}) => ({
	id,
	task: `Task ${id}`,
	ts,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	// useTaskSearch keeps only tasks from the current workspace.
	workspace: "/test/workspace",
	...extra,
})

const setState = (taskHistory: any[]) => {
	;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
		taskHistory,
		cwd: "/test/workspace",
	})
	;(useExtensionSelector as ReturnType<typeof vi.fn>).mockImplementation((selector: any) =>
		selector({ taskHistory, cwd: "/test/workspace" }),
	)
}

const renderHistory = (taskHistory: any[]) => {
	setState(taskHistory)
	return render(<HistoryView onDone={() => {}} />)
}

describe("HistoryView §2.9", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("history rows are real buttons and clicking opens the task", () => {
		renderHistory([task("1", now - 1000)])

		const row = screen.getByTestId("task-item-1")
		expect(row.tagName).toBe("BUTTON")
		expect(row).toHaveAttribute("aria-label", "Task 1")
		expect((row as HTMLButtonElement).tabIndex).toBe(0)

		fireEvent.click(row)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "1" })
	})

	it("day headers are interleaved with the parent-child groups", () => {
		renderHistory([
			task("1", now - 1000), // today
			task("2", now - DAY - 3600_000), // yesterday
			task("3", now - 1000, { parentTaskId: "1" }), // subtask of 1
		])

		// Two day headers: today's and yesterday's.
		const headers = screen.getAllByTestId(/history-day-/)
		expect(headers.length).toBe(2)
		expect(headers[0].textContent).toBe("history:today")
		expect(headers[1].textContent).toBe("history:yesterday")

		// The parent-child tree survives: the subtask renders under its parent
		// group (via TaskGroupItem -> SubtaskCollapsibleRow -> SubtaskRow).
		expect(screen.getByTestId("subtask-row-3")).toBeInTheDocument()
	})

	it("shows the empty state when there is no history at all", () => {
		renderHistory([])
		expect(screen.getByTestId("history-empty-state")).toBeInTheDocument()
		expect(screen.getByText("history:noHistory")).toBeInTheDocument()
		expect(screen.queryByTestId("virtuoso-container")).toBeNull()
	})

	it("shows the empty-search state when a query matches nothing", () => {
		renderHistory([task("1", now - 1000)])
		// ThemedTextField spreads data-testid onto the <input> itself.
		fireEvent.input(screen.getByTestId("history-search-input"), {
			target: { value: "zzz-no-match" },
		})
		expect(screen.getByTestId("history-empty-search")).toBeInTheDocument()
		expect(screen.getByText("history:noSearchResults")).toBeInTheDocument()
	})
})

describe("TaskItem §2.9", () => {
	it("renders as a <button> with a tabular-numeral timestamp", () => {
		render(
			<TaskItem
				item={task("1", now - 1000, { totalCost: 0.005 }) as any}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		const row = screen.getByTestId("task-item-1")
		expect(row.tagName).toBe("BUTTON")

		// The timestamp span uses tabular numerals so columns line up.
		const timestamp = row.querySelector(".tabular-nums")
		expect(timestamp).not.toBeNull()
		expect(timestamp!.textContent).toMatch(/\d/)
	})
})
