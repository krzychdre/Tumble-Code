import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import SubtaskRow from "../SubtaskRow"
import { SubagentTranscriptContext } from "../../chat/SubagentTranscriptContext"
import type { SubtaskTreeNode, DisplayHistoryItem } from "../types"

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

	const withChildren = (isExpanded: boolean) =>
		createMockNode(
			{ id: "parent-1", task: "Parent" },
			[
				createMockNode({ id: "child-1", task: "Child 1" }, [createMockNode({ id: "grandchild-1" })], true),
				createMockNode({ id: "child-2", task: "Child 2" }),
			],
			isExpanded,
		)

	it("a leaf row is indented by its depth and has no subtask toggle", () => {
		render(<SubtaskRow node={createMockNode({ id: "leaf-1" })} depth={2} onToggleExpand={vi.fn()} />)

		expect(screen.getByRole("button")).toHaveStyle({ paddingLeft: "32px" })
		expect(screen.queryByTestId("subtask-collapsible-row")).not.toBeInTheDocument()
	})

	it("opens the task on click", () => {
		render(<SubtaskRow node={createMockNode({ id: "task-42" })} depth={1} onToggleExpand={vi.fn()} />)

		fireEvent.click(screen.getByRole("button"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "task-42" })
	})

	it("a parallel subagent opens its transcript instead of becoming the open task", () => {
		const open = vi.fn()
		render(
			<SubagentTranscriptContext.Provider value={open}>
				<SubtaskRow
					node={createMockNode({ id: "sub-1", isSubagent: true })}
					depth={1}
					onToggleExpand={vi.fn()}
				/>
			</SubagentTranscriptContext.Provider>,
		)

		fireEvent.click(screen.getByRole("button"))

		expect(open).toHaveBeenCalledWith("sub-1")
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("the toggle counts the whole subtree and expands this node only", () => {
		const onToggleExpand = vi.fn()
		render(<SubtaskRow node={withChildren(false)} depth={1} onToggleExpand={onToggleExpand} />)
		const [toggle] = screen.getAllByTestId("subtask-collapsible-row")
		expect(toggle).toHaveTextContent("history:subtasks:3")

		fireEvent.click(toggle)

		expect(onToggleExpand).toHaveBeenCalledWith("parent-1")
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	// A collapsed list stays mounted for the height animation; `inert` keeps Tab off its rows.
	it.each([false, true])("expanded=%s: nested rows are rendered, inert only while collapsed", (isExpanded) => {
		render(<SubtaskRow node={withChildren(isExpanded)} depth={1} onToggleExpand={vi.fn()} />)

		const list = screen.getByTestId("subtask-row-child-1").parentElement!
		expect(list.hasAttribute("inert")).toBe(!isExpanded)
		expect(list.classList.contains("max-h-0")).toBe(!isExpanded)
		expect(screen.getByTestId("subtask-row-grandchild-1")).toBeInTheDocument()
	})

	describe("running status", () => {
		it("puts a spinner in the bullet's slot while the subtask works and describes the row by it", () => {
			render(
				<SubtaskRow
					node={createMockNode({ id: "leaf-1", task: "Working subtask", runningStatus: "running" })}
					depth={1}
					onToggleExpand={vi.fn()}
				/>,
			)

			const indicator = screen.getByRole("img", { name: "history:runningIndicator.running" })
			expect(screen.queryByTestId("subtask-bullet")).not.toBeInTheDocument()
			const describedBy = screen.getByRole("button", { name: "Working subtask" }).getAttribute("aria-describedby")
			expect(describedBy?.split(" ")).toEqual([indicator.id, screen.getByTestId("task-details").id])
		})

		it.each([
			{ runningStatus: "awaiting_input" as const, indicator: "running-indicator-awaiting_input", bullet: false },
			{ runningStatus: undefined, indicator: undefined, bullet: true },
		])("$runningStatus: shows the right marker", ({ runningStatus, indicator, bullet }) => {
			render(<SubtaskRow node={createMockNode({ runningStatus })} depth={1} onToggleExpand={vi.fn()} />)

			expect(screen.queryAllByTestId(/^running-indicator-/).map((el) => el.dataset.testid)).toEqual(
				indicator ? [indicator] : [],
			)
			expect(screen.queryByTestId("subtask-bullet") !== null).toBe(bullet)
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
