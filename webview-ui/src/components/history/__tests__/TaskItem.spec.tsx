import { render, screen, fireEvent } from "@/utils/test-utils"

import TaskItem from "../TaskItem"

vi.mock("@src/utils/vscode")
// TaskDetails reads the custom modes to name a task's mode.
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: never) => unknown) => selector({ customModes: [] } as never),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/utils/format", () => ({
	formatDateTime: vi.fn(() => "2026-05-22 17:50:33"),
	formatTimestamp: vi.fn(() => "17:50"),
	formatLargeNumber: vi.fn((num: number) => num.toString()),
}))

const mockTask = {
	id: "1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "/test/workspace",
}

describe("TaskItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders task information", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		expect(screen.getByText("Test task")).toBeInTheDocument()
		expect(screen.getByText("$0.00")).toBeInTheDocument() // Component shows $0.00 for small amounts
	})

	it("handles selection in selection mode", () => {
		const onToggleSelection = vi.fn()
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={onToggleSelection}
				isSelectionMode={true}
			/>,
		)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(onToggleSelection).toHaveBeenCalledWith("1", true)
	})

	it("shows action buttons", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should show copy and export buttons
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.getByTestId("export")).toBeInTheDocument()
	})

	it("displays the task date and time", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		// A task from today shows its time; the day header carries the date
		expect(screen.getByText("17:50")).toBeInTheDocument()
	})

	it("shows the row in the full foreground colour, not dimmed", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		const taskItem = screen.getByTestId("task-item-1")
		expect(taskItem).toHaveClass("text-vscode-foreground")
		expect(taskItem.className).not.toContain("text-vscode-foreground/80")
	})

	describe("running status", () => {
		it.each(["compact", "full"] as const)("shows a spinner on a working task (%s)", (variant) => {
			render(<TaskItem item={{ ...mockTask, runningStatus: "running" }} variant={variant} />)

			const indicator = screen.getByRole("img", { name: "history:runningIndicator.running" })
			expect(indicator).toHaveAttribute("data-testid", "running-indicator-running")
			expect(indicator.querySelector(".ui-progress-ring")).toBeInTheDocument()
			const details = screen.getByTestId("task-details")
			expect(screen.getByTestId("task-item-1")).toHaveAttribute(
				"aria-describedby",
				`${indicator.id} ${details.id}`,
			)
		})

		it("shows the attention icon on a task waiting for input", () => {
			render(<TaskItem item={{ ...mockTask, runningStatus: "awaiting_input" }} variant="full" />)

			const indicator = screen.getByRole("img", { name: "history:runningIndicator.awaitingInput" })
			expect(indicator).toHaveAttribute("data-testid", "running-indicator-awaiting_input")
			expect(indicator.querySelector(".ui-progress-ring")).not.toBeInTheDocument()
		})

		it("shows nothing on a task at rest", () => {
			render(<TaskItem item={mockTask} variant="full" />)

			expect(screen.queryByTestId(/^running-indicator-/)).not.toBeInTheDocument()
			// Only the summary line describes a task at rest.
			expect(screen.getByTestId("task-item-1")).toHaveAttribute(
				"aria-describedby",
				screen.getByTestId("task-details").id,
			)
		})
	})
})
