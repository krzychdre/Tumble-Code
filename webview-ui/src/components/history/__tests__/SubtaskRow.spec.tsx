import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import SubtaskRow from "../SubtaskRow"
import type { SubtaskTreeNode, DisplayHistoryItem } from "../types"

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
			if (key === "history:collapseSubtasks") return "Collapse subtasks"
			if (key === "history:expandSubtasks") return "Expand subtasks"
			return key
		},
	}),
}))

const createMockDisplayItem = (overrides: Partial<DisplayHistoryItem> = {}): DisplayHistoryItem => ({
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

const createMockNode = (
	itemOverrides: Partial<DisplayHistoryItem> = {},
	children: SubtaskTreeNode[] = [],
	isExpanded = false,
): SubtaskTreeNode => ({
	item: createMockDisplayItem(itemOverrides),
	children,
	isExpanded,
})

describe("SubtaskRow", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("leaf node rendering", () => {
		it("renders leaf node with correct text", () => {
			const node = createMockNode({ id: "leaf-1", task: "Leaf task content" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByText("Leaf task content")).toBeInTheDocument()
		})

		it("renders with correct depth indentation", () => {
			const node = createMockNode({ id: "leaf-1", task: "Indented task" })

			render(<SubtaskRow node={node} depth={2} onToggleExpand={vi.fn()} />)

			const row = screen.getByTestId("subtask-row-leaf-1")
			// §2.9: the clickable row is a real <button>; paddingLeft = depth * 16 = 32px
			const clickableRow = row.querySelector("button")
			expect(clickableRow).not.toBeNull()
			expect(clickableRow).toHaveStyle({ paddingLeft: "32px" })
		})

		it("does not render collapsible row for leaf node", () => {
			const node = createMockNode({ id: "leaf-1", task: "Leaf only" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.queryByTestId("subtask-collapsible-row")).not.toBeInTheDocument()
		})
	})

	describe("node with children", () => {
		it("renders collapsible row with correct child count", () => {
			const node = createMockNode(
				{ id: "parent-1", task: "Parent task" },
				[
					createMockNode({ id: "child-1", task: "Child 1" }),
					createMockNode({ id: "child-2", task: "Child 2" }),
				],
				false,
			)

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByText("2 Subtasks")).toBeInTheDocument()
			expect(screen.getByTestId("subtask-collapsible-row")).toBeInTheDocument()
		})

		it("renders nested children count including grandchildren", () => {
			const node = createMockNode(
				{ id: "parent-1", task: "Parent task" },
				[
					createMockNode({ id: "child-1", task: "Child 1" }, [
						createMockNode({ id: "grandchild-1", task: "Grandchild 1" }),
					]),
				],
				false,
			)

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			// countAllSubtasks counts child-1 (1) + grandchild-1 (1) = 2
			expect(screen.getByText("2 Subtasks")).toBeInTheDocument()
		})
	})

	describe("click behavior", () => {
		it("sends showTaskWithId message when task row is clicked", () => {
			const node = createMockNode({ id: "task-42", task: "Clickable task" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			const row = screen.getByRole("button")
			fireEvent.click(row)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "task-42",
			})
		})

		it("calls onToggleExpand with correct task ID when collapsible row is clicked", () => {
			const onToggleExpand = vi.fn()
			const node = createMockNode(
				{ id: "expandable-1", task: "Expandable task" },
				[createMockNode({ id: "child-1", task: "Child" })],
				false,
			)

			render(<SubtaskRow node={node} depth={1} onToggleExpand={onToggleExpand} />)

			const collapsibleRow = screen.getByTestId("subtask-collapsible-row")
			fireEvent.click(collapsibleRow)

			expect(onToggleExpand).toHaveBeenCalledWith("expandable-1")
		})
	})

	describe("expand/collapse behavior", () => {
		it("renders child SubtaskRow components when expanded", () => {
			const node = createMockNode(
				{ id: "parent-1", task: "Parent" },
				[
					createMockNode({ id: "child-1", task: "Child 1" }),
					createMockNode({ id: "child-2", task: "Child 2" }),
				],
				true, // expanded
			)

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("subtask-row-child-1")).toBeInTheDocument()
			expect(screen.getByTestId("subtask-row-child-2")).toBeInTheDocument()
			expect(screen.getByText("Child 1")).toBeInTheDocument()
			expect(screen.getByText("Child 2")).toBeInTheDocument()
		})

		it("uses max-h-0 for collapsed node with children", () => {
			const node = createMockNode(
				{ id: "parent-1", task: "Parent" },
				[createMockNode({ id: "child-1", task: "Child 1" })],
				false, // collapsed
			)

			const { container } = render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			// The children wrapper div should have max-h-0 when collapsed
			const childrenWrapper = container.querySelector(".max-h-0")
			expect(childrenWrapper).toBeInTheDocument()
		})

		it("does not use max-h-0 when node is expanded", () => {
			const node = createMockNode(
				{ id: "parent-1", task: "Parent" },
				[createMockNode({ id: "child-1", task: "Child 1" })],
				true, // expanded
			)

			const { container } = render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			// The children wrapper should NOT have max-h-0 when expanded
			const collapsedWrapper = container.querySelector(".max-h-0")
			expect(collapsedWrapper).not.toBeInTheDocument()
		})

		it("renders deeply nested recursive structure when all levels expanded", () => {
			const node = createMockNode(
				{ id: "root", task: "Root" },
				[
					createMockNode(
						{ id: "child", task: "Child" },
						[createMockNode({ id: "grandchild", task: "Grandchild" })],
						true, // child expanded
					),
				],
				true, // root expanded
			)

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("subtask-row-root")).toBeInTheDocument()
			expect(screen.getByTestId("subtask-row-child")).toBeInTheDocument()
			expect(screen.getByTestId("subtask-row-grandchild")).toBeInTheDocument()
			expect(screen.getByText("Grandchild")).toBeInTheDocument()
		})
	})

	describe("running status", () => {
		it("shows a spinner on a working subtask", () => {
			const node = createMockNode({ id: "leaf-1", task: "Working subtask", runningStatus: "running" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			const indicator = screen.getByRole("img", { name: "history:runningIndicator.running" })
			expect(indicator.querySelector(".ui-progress-ring")).toBeInTheDocument()
			const describedBy = screen.getByRole("button", { name: "Working subtask" }).getAttribute("aria-describedby")
			expect(describedBy?.split(" ")).toEqual([indicator.id, screen.getByTestId("task-details").id])
		})

		it("shows the attention icon on a subtask waiting for input", () => {
			const node = createMockNode({ id: "leaf-1", task: "Asking subtask", runningStatus: "awaiting_input" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByRole("img", { name: "history:runningIndicator.awaitingInput" })).toBeInTheDocument()
			expect(screen.queryByTestId("running-indicator-running")).not.toBeInTheDocument()
		})

		it("shows a list bullet, not a status, on a subtask at rest", () => {
			const node = createMockNode({ id: "leaf-1", task: "Resting subtask" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.queryByTestId(/^running-indicator-/)).not.toBeInTheDocument()
			expect(screen.getByTestId("subtask-bullet")).toBeInTheDocument()
		})

		it("puts the status in the bullet's slot while the subtask works", () => {
			const node = createMockNode({ id: "leaf-1", task: "Working subtask", runningStatus: "running" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("running-indicator-running")).toBeInTheDocument()
			expect(screen.queryByTestId("subtask-bullet")).not.toBeInTheDocument()
		})

		it("marks a working nested subtask", () => {
			const node = createMockNode(
				{ id: "parent-1", task: "Parent" },
				[createMockNode({ id: "child-1", task: "Child", runningStatus: "running" })],
				true,
			)

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			const child = screen.getByTestId("subtask-row-child-1")
			expect(child.querySelector('[data-testid="running-indicator-running"]')).toBeInTheDocument()
			expect(screen.getAllByTestId(/^running-indicator-/)).toHaveLength(1)
		})
	})

	describe("details line", () => {
		it("shows the mode, outcome, cost and tokens of a finished subtask", () => {
			const node = createMockNode({
				id: "leaf-1",
				task: "Finished subtask",
				mode: "code",
				status: "completed",
				totalCost: 0.21,
				tokensIn: 1_861_246,
				tokensOut: 35_636,
			})

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			const details = screen.getByTestId("task-details")
			expect(details).toHaveTextContent("Code")
			expect(screen.getByTestId("task-outcome-completed")).toHaveTextContent("history:taskOutcome.completed")
			expect(screen.getByTestId("task-cost")).toHaveTextContent("$0.21")
			// The k/m suffixes come from an uninitialised i18next in tests, so check the numbers.
			expect(details).toHaveTextContent(/↑1\.9.* ↓35\.6/)
			expect(screen.getByRole("button", { name: "Finished subtask" })).toHaveAttribute(
				"aria-describedby",
				details.id,
			)
		})

		it("marks a subtask at rest that never completed as unfinished", () => {
			const node = createMockNode({ id: "leaf-1", task: "Stopped subtask", status: "active" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("task-outcome-unfinished")).toBeInTheDocument()
		})

		it("takes the outcome saved from the messages over the status", () => {
			const node = createMockNode({
				id: "leaf-1",
				task: "Reopened subtask",
				status: "completed",
				outcome: "unfinished",
			})

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("task-outcome-unfinished")).toBeInTheDocument()
		})

		it("leaves the outcome to the live status while the subtask works", () => {
			const node = createMockNode({ id: "leaf-1", task: "Working subtask", runningStatus: "running" })

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.queryByTestId(/^task-outcome-/)).not.toBeInTheDocument()
		})

		it("shows the cost of the subtask's own subtasks too", () => {
			const node = createMockNode({
				id: "leaf-1",
				task: "Delegating subtask",
				totalCost: 0.1,
				subtree: { cost: 0.5, tokensIn: 0, tokensOut: 0 },
			})

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("task-cost")).toHaveTextContent("$0.50")
		})

		it("leaves out the cost of a subtask that cost nothing, separator included", () => {
			const node = createMockNode({
				id: "leaf-1",
				task: "Free subtask",
				status: "active",
				totalCost: 0,
				tokensIn: 0,
				tokensOut: 0,
			})

			render(<SubtaskRow node={node} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.queryByTestId("task-cost")).not.toBeInTheDocument()
			// Only the start time and the outcome are left, so one separator between them.
			expect(screen.getByTestId("task-details").textContent?.split("·")).toHaveLength(2)
		})
	})
})
