import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import TaskGroupItem from "../TaskGroupItem"
import type { TaskGroup, DisplayHistoryItem, SubtaskTreeNode } from "../types"

vi.mock("@src/utils/vscode")
// TaskDetails reads the custom modes to name a task's mode.
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: never) => unknown) => selector({ customModes: [] } as never),
}))
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options?.count !== undefined ? `${key}:${options.count}` : key,
	}),
}))

vi.mock("@/utils/format", () => ({
	formatDateTime: vi.fn(() => "2026-05-22 17:50:33"),
	formatTimestamp: vi.fn(() => "17:50"),
	formatLargeNumber: vi.fn((num: number) => num.toString()),
}))

const createMockDisplayHistoryItem = (overrides: Partial<DisplayHistoryItem> = {}): DisplayHistoryItem => ({
	id: "task-1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.01,
	workspace: "/workspace/project",
	...overrides,
})

const createMockSubtaskNode = (
	itemOverrides: Partial<DisplayHistoryItem> = {},
	children: SubtaskTreeNode[] = [],
	isExpanded = false,
): SubtaskTreeNode => ({
	item: createMockDisplayHistoryItem(itemOverrides),
	children,
	isExpanded,
})

const createMockGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
	parent: createMockDisplayHistoryItem({ id: "parent-1", task: "Parent task" }),
	subtasks: [],
	isExpanded: false,
	...overrides,
})

const renderGroup = (group: TaskGroup, props: Partial<Parameters<typeof TaskGroupItem>[0]> = {}) => {
	const onToggleExpand = vi.fn()
	render(
		<TaskGroupItem
			group={group}
			variant="full"
			onToggleExpand={onToggleExpand}
			onToggleSubtaskExpand={vi.fn()}
			{...props}
		/>,
	)
	return { onToggleExpand }
}

const withSubtasks = (isExpanded: boolean) =>
	createMockGroup({
		isExpanded,
		subtasks: [
			createMockSubtaskNode(
				{ id: "child-1", task: "Child 1" },
				[createMockSubtaskNode({ id: "grandchild-1", task: "Grandchild 1" })],
				true,
			),
			createMockSubtaskNode({ id: "child-2", task: "Child 2" }),
		],
	})

describe("TaskGroupItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("wires the parent row: selection reports the parent id", () => {
		const onToggleSelection = vi.fn()
		renderGroup(createMockGroup(), { isSelectionMode: true, isSelected: true, onToggleSelection })

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()
		fireEvent.click(checkbox)

		expect(onToggleSelection).toHaveBeenCalledWith("parent-1", false)
	})

	it("passes delete to the parent row outside selection mode", () => {
		const onDelete = vi.fn()
		renderGroup(createMockGroup(), { onDelete })

		fireEvent.click(screen.getByTestId("delete-task-button"))

		expect(onDelete).toHaveBeenCalledWith("parent-1")
	})

	it("shows no subtask toggle and no list without subtasks", () => {
		renderGroup(createMockGroup())

		expect(screen.queryByTestId("subtask-collapsible-row")).not.toBeInTheDocument()
		expect(screen.queryByTestId("subtask-list")).not.toBeInTheDocument()
	})

	it("counts the whole subtask tree, grandchildren included", () => {
		renderGroup(withSubtasks(false))

		// The first toggle is the group's; the nested child has its own.
		expect(screen.getAllByTestId("subtask-collapsible-row")[0]).toHaveTextContent("history:subtasks:3")
	})

	// A collapsed list stays mounted for the height animation; `inert` keeps Tab off its rows.
	it.each([
		{ isExpanded: false, label: "history:expandSubtasks", inert: true },
		{ isExpanded: true, label: "history:collapseSubtasks", inert: false },
	])("expanded=$isExpanded: the toggle says so and the list is inert=$inert", ({ isExpanded, label, inert }) => {
		renderGroup(withSubtasks(isExpanded))

		const [groupToggle] = screen.getAllByTestId("subtask-collapsible-row")
		expect(groupToggle).toHaveAccessibleName(label)
		expect(groupToggle).toHaveAttribute("aria-expanded", String(isExpanded))
		const list = screen.getByTestId("subtask-list")
		expect(list.hasAttribute("inert")).toBe(inert)
		expect(list.classList.contains("max-h-0")).toBe(!isExpanded)
		expect(screen.getByTestId("subtask-row-grandchild-1")).toBeInTheDocument()
	})

	it("the toggle expands the group without opening the task or bubbling to a parent", () => {
		const parentClick = vi.fn()
		const onToggleExpand = vi.fn()
		render(
			<div onClick={parentClick}>
				<TaskGroupItem
					group={withSubtasks(false)}
					variant="full"
					onToggleExpand={onToggleExpand}
					onToggleSubtaskExpand={vi.fn()}
				/>
			</div>,
		)

		fireEvent.click(screen.getAllByTestId("subtask-collapsible-row")[0])

		expect(onToggleExpand).toHaveBeenCalledTimes(1)
		expect(parentClick).not.toHaveBeenCalled()
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "showTaskWithId" }))
	})
})
