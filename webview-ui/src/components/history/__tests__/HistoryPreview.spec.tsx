import { fireEvent, render, screen } from "@/utils/test-utils"

import type { HistoryItem } from "@tumble-code/types"

import { vscode } from "@src/utils/vscode"

import HistoryPreview from "../HistoryPreview"
import type { TaskGroup } from "../types"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
vi.mock("../useTaskSearch", () => ({ useTaskSearch: () => ({ tasks: [], searchQuery: "" }) }))
vi.mock("../useGroupedTasks")
vi.mock("../TaskGroupItem", () => ({
	default: ({ group, variant, onToggleExpand }: any) => (
		<button data-testid={`task-group-${group.parent.id}`} data-variant={variant} onClick={onToggleExpand} />
	),
}))

import { useGroupedTasks } from "../useGroupedTasks"

const toggleExpand = vi.fn()

/** Six groups, newest first; `parent` adds fields to the parent of the group at that index. */
const showGroups = (parent: (index: number) => Partial<HistoryItem> = () => ({})) => {
	const groups: TaskGroup[] = Array.from({ length: 6 }, (_, index) => ({
		parent: { id: `task-${index + 1}`, number: index + 1, task: "t", ts: 600 - index, ...parent(index) },
		subtasks: [],
		isExpanded: false,
	})) as TaskGroup[]
	vi.mocked(useGroupedTasks).mockReturnValue({ groups, toggleExpand } as any)
}

const shownIds = () => screen.queryAllByTestId(/task-group-/).map((el) => el.dataset.testid!.replace("task-group-", ""))

describe("HistoryPreview", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("shows the first 4 groups as compact rows", () => {
		showGroups()
		render(<HistoryPreview />)

		expect(shownIds()).toEqual(["task-1", "task-2", "task-3", "task-4"])
		expect(screen.getByTestId("task-group-task-1")).toHaveAttribute("data-variant", "compact")
	})

	it("shows fewer groups when there are fewer", () => {
		vi.mocked(useGroupedTasks).mockReturnValue({ groups: [], toggleExpand } as any)
		render(<HistoryPreview />)

		expect(shownIds()).toEqual([])
	})

	// useGroupedTasks puts the pinned and working groups first; all of them show, even past 4.
	it.each([
		{ name: "five working groups", parent: (i: number) => (i < 5 ? { runningStatus: "running" } : {}) },
		{
			name: "three pinned and two working groups",
			parent: (i: number) => (i < 3 ? { pinnedAt: i + 1 } : i < 5 ? { runningStatus: "running" } : {}),
		},
	])("shows every section group past 4: $name", ({ parent }) => {
		showGroups(parent as (index: number) => Partial<HistoryItem>)
		render(<HistoryPreview />)

		expect(shownIds()).toEqual(["task-1", "task-2", "task-3", "task-4", "task-5"])
	})

	it("expands a group by its parent id", () => {
		showGroups()
		render(<HistoryPreview />)

		fireEvent.click(screen.getByTestId("task-group-task-2"))

		expect(toggleExpand).toHaveBeenCalledWith("task-2")
	})

	it("View all switches to the history tab", () => {
		showGroups()
		render(<HistoryPreview />)

		fireEvent.click(screen.getByRole("button", { name: "history:viewAllHistory" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "switchTab", tab: "history" })
	})
})
