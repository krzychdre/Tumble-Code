import { render, screen, fireEvent } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

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
		t: (key: string, options?: Record<string, unknown>) => {
			if (key === "history:subtasks" && options?.count !== undefined) {
				return `${options.count} Subtask${options.count === 1 ? "" : "s"}`
			}
			if (key === "history:subtaskTag") return "Subtask: "
			if (key === "history:collapseSubtasks") return "Collapse subtasks"
			if (key === "history:expandSubtasks") return "Expand subtasks"
			return key
		},
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

describe("TaskGroupItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("parent task rendering", () => {
		it("renders parent task content", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({
					id: "parent-1",
					task: "Test parent task content",
				}),
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.getByText("Test parent task content")).toBeInTheDocument()
		})

		it("renders group container with correct test id", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "my-parent-id" }),
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.getByTestId("task-group-my-parent-id")).toBeInTheDocument()
		})
	})

	describe("subtask count display", () => {
		it("shows correct subtask count", () => {
			const group = createMockGroup({
				subtasks: [
					createMockSubtaskNode({ id: "child-1", task: "Child 1" }),
					createMockSubtaskNode({ id: "child-2", task: "Child 2" }),
					createMockSubtaskNode({ id: "child-3", task: "Child 3" }),
				],
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.getByText("3 Subtasks")).toBeInTheDocument()
		})

		it("shows singular subtask text for single subtask", () => {
			const group = createMockGroup({
				subtasks: [createMockSubtaskNode({ id: "child-1", task: "Child 1" })],
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.getByText("1 Subtask")).toBeInTheDocument()
		})

		it("does not show subtask row when no subtasks", () => {
			const group = createMockGroup({ subtasks: [] })

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.queryByTestId("subtask-collapsible-row")).not.toBeInTheDocument()
		})

		it("renders correct total subtask count with nested children", () => {
			const group = createMockGroup({
				subtasks: [
					createMockSubtaskNode({ id: "child-1", task: "Child 1" }, [
						createMockSubtaskNode({ id: "grandchild-1", task: "Grandchild 1" }),
						createMockSubtaskNode({ id: "grandchild-2", task: "Grandchild 2" }),
					]),
					createMockSubtaskNode({ id: "child-2", task: "Child 2" }),
				],
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			// 2 direct children + 2 grandchildren = 4 total
			expect(screen.getByText("4 Subtasks")).toBeInTheDocument()
		})
	})

	describe("expand/collapse behavior", () => {
		it("calls onToggleExpand when chevron row is clicked", () => {
			const onToggleExpand = vi.fn()
			const group = createMockGroup({
				subtasks: [createMockSubtaskNode({ id: "child-1", task: "Child 1" })],
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					onToggleExpand={onToggleExpand}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			const collapsibleRow = screen.getByTestId("subtask-collapsible-row")
			fireEvent.click(collapsibleRow)

			expect(onToggleExpand).toHaveBeenCalledTimes(1)
		})

		it("shows subtasks when expanded", () => {
			const group = createMockGroup({
				isExpanded: true,
				subtasks: [
					createMockSubtaskNode({ id: "child-1", task: "Subtask content 1" }),
					createMockSubtaskNode({ id: "child-2", task: "Subtask content 2" }),
				],
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.getByTestId("subtask-list")).toBeInTheDocument()
			expect(screen.getByText("Subtask content 1")).toBeInTheDocument()
			expect(screen.getByText("Subtask content 2")).toBeInTheDocument()
		})

		it("hides subtasks when collapsed", () => {
			const group = createMockGroup({
				isExpanded: false,
				subtasks: [createMockSubtaskNode({ id: "child-1", task: "Subtask content" })],
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			// The subtask-list element is present but collapsed via CSS (max-h-0)
			const subtaskList = screen.queryByTestId("subtask-list")
			expect(subtaskList).toBeInTheDocument()
			expect(subtaskList).toHaveClass("max-h-0")
		})

		it("renders nested subtask when a node has children and is expanded", () => {
			const group = createMockGroup({
				isExpanded: true,
				subtasks: [
					createMockSubtaskNode(
						{ id: "child-1", task: "Parent subtask" },
						[createMockSubtaskNode({ id: "grandchild-1", task: "Nested subtask" })],
						true, // child-1 is expanded
					),
				],
			})

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			expect(screen.getByText("Parent subtask")).toBeInTheDocument()
			expect(screen.getByText("Nested subtask")).toBeInTheDocument()
			expect(screen.getByTestId("subtask-row-grandchild-1")).toBeInTheDocument()
		})
	})

	describe("selection mode", () => {
		it("handles selection mode correctly", () => {
			const onToggleSelection = vi.fn()
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "parent-1" }),
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					isSelectionMode={true}
					isSelected={false}
					onToggleSelection={onToggleSelection}
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			const checkbox = screen.getByRole("checkbox")
			fireEvent.click(checkbox)

			expect(onToggleSelection).toHaveBeenCalledWith("parent-1", true)
		})

		it("shows selected state when isSelected is true", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "parent-1" }),
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					isSelectionMode={true}
					isSelected={true}
					onToggleSelection={vi.fn()}
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			const checkbox = screen.getByRole("checkbox")
			// Checked state through the accessible role, not the widget's markup.
			expect(checkbox).toBeChecked()
		})
	})

	describe("variant handling", () => {
		it("passes compact variant to TaskItem", () => {
			const group = createMockGroup()

			render(
				<TaskGroupItem
					group={group}
					variant="compact"
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			// TaskItem should be rendered with compact styling
			const taskItem = screen.getByTestId("task-item-parent-1")
			expect(taskItem).toBeInTheDocument()
		})

		it("passes full variant to TaskItem", () => {
			const group = createMockGroup()

			render(
				<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} onToggleSubtaskExpand={vi.fn()} />,
			)

			const taskItem = screen.getByTestId("task-item-parent-1")
			expect(taskItem).toBeInTheDocument()
		})
	})

	describe("delete handling", () => {
		it("passes onDelete to TaskItem", () => {
			const onDelete = vi.fn()
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "parent-1", task: "Parent task" }),
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					onDelete={onDelete}
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			// Delete button uses "delete-task-button" as testid
			const deleteButton = screen.getByTestId("delete-task-button")
			fireEvent.click(deleteButton)

			expect(onDelete).toHaveBeenCalledWith("parent-1")
		})
	})

	describe("workspace display", () => {
		it("passes showWorkspace to TaskItem", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({
					id: "parent-1",
					workspace: "/test/workspace/path",
				}),
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					showWorkspace={true}
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			// Workspace should be displayed in TaskItem
			const taskItem = screen.getByTestId("task-item-parent-1")
			expect(taskItem).toBeInTheDocument()
			// Check that workspace folder is shown
			expect(screen.getByText("/test/workspace/path")).toBeInTheDocument()
		})
	})

	describe("custom className", () => {
		it("applies custom className to container", () => {
			const group = createMockGroup()

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					className="custom-class"
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			const container = screen.getByTestId("task-group-parent-1")
			expect(container).toHaveClass("custom-class")
		})

		it("is a framed card on the shared surface", () => {
			render(
				<TaskGroupItem
					group={createMockGroup()}
					variant="compact"
					onToggleExpand={vi.fn()}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)

			// A transparent border made the rows blend into the panel in most themes.
			const container = screen.getByTestId("task-group-parent-1")
			expect(container).toHaveClass("border-frame", "bg-surface", "hover:border-frame-hover", "rounded-control")
			expect(container).not.toHaveClass("border-transparent")
		})
	})
	describe("keyboard access to the subtask toggle", () => {
		const renderGroup = (isExpanded = false, onToggleExpand = vi.fn()) => {
			const group = createMockGroup({
				isExpanded,
				subtasks: [createMockSubtaskNode({ id: "child-1", task: "Child 1" })],
			})
			render(
				<TaskGroupItem
					group={group}
					variant="full"
					onToggleExpand={onToggleExpand}
					onToggleSubtaskExpand={vi.fn()}
				/>,
			)
			return onToggleExpand
		}

		it("is a real button that says whether the list is open", () => {
			renderGroup(false)
			const toggle = screen.getByRole("button", { name: "Expand subtasks" })
			expect(toggle.tagName).toBe("BUTTON")
			expect(toggle).toHaveAttribute("type", "button")
			expect(toggle).toHaveAttribute("aria-expanded", "false")
			expect(toggle).toHaveClass("w-full", "focus-visible:outline-vscode-focusBorder")
		})

		it("reports the open state", () => {
			renderGroup(true)
			expect(screen.getByRole("button", { name: "Collapse subtasks" })).toHaveAttribute("aria-expanded", "true")
		})

		it("is reached with Tab and toggles with Enter and Space", async () => {
			const user = userEvent.setup()
			const onToggleExpand = renderGroup(false)
			const toggle = screen.getByTestId("subtask-collapsible-row")

			for (let i = 0; i < 20 && document.activeElement !== toggle; i++) {
				await user.tab()
			}
			expect(toggle).toHaveFocus()

			await user.keyboard("{Enter}")
			expect(onToggleExpand).toHaveBeenCalledTimes(1)
			await user.keyboard(" ")
			expect(onToggleExpand).toHaveBeenCalledTimes(2)
			expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "showTaskWithId" }))
		})

		it("does not open the task or reach a parent click handler when clicked", () => {
			const parentClick = vi.fn()
			const group = createMockGroup({ subtasks: [createMockSubtaskNode({ id: "child-1", task: "Child 1" })] })
			render(
				<div onClick={parentClick}>
					<TaskGroupItem
						group={group}
						variant="full"
						onToggleExpand={vi.fn()}
						onToggleSubtaskExpand={vi.fn()}
					/>
				</div>,
			)
			fireEvent.click(screen.getByTestId("subtask-collapsible-row"))
			expect(parentClick).not.toHaveBeenCalled()
			expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "showTaskWithId" }))
		})
		it("keeps Tab off the subtasks of a collapsed group", () => {
			renderGroup(false)
			expect(screen.getByTestId("subtask-list")).toHaveAttribute("inert")
		})

		it("lets Tab into the subtasks of an expanded group", () => {
			renderGroup(true)
			expect(screen.getByTestId("subtask-list")).not.toHaveAttribute("inert")
		})
	})
})
