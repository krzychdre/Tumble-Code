import { render, screen } from "@/utils/test-utils"

import TaskItemFooter from "../TaskItemFooter"

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

const mockItem = {
	id: "1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "/test/workspace",
}

describe("TaskItemFooter", () => {
	it("renders the time of a task from today", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		expect(screen.getByText("17:50")).toBeInTheDocument()
	})

	it("renders the full date and time of an older task", () => {
		render(<TaskItemFooter item={{ ...mockItem, ts: new Date("2022-02-16T12:00:00").getTime() }} variant="full" />)

		expect(screen.getByText("2026-05-22 17:50:33")).toBeInTheDocument()
	})

	it("renders cost information", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		// The component shows $0.00 for small amounts, not the exact value
		expect(screen.getByText("$0.00")).toBeInTheDocument()
	})

	it("shows action buttons", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		// Should show copy and export buttons
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.getByTestId("export")).toBeInTheDocument()
	})

	it("the hover-only action buttons also show while the row or a button has keyboard focus", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		const actions = screen.getByTestId("copy-prompt-button").parentElement
		expect(actions).toHaveClass(
			"opacity-0",
			"group-hover:opacity-100",
			"group-focus-visible:opacity-100",
			"group-has-focus-visible:opacity-100",
		)
	})

	it("hides export button in compact variant", () => {
		render(<TaskItemFooter item={mockItem} variant="compact" />)

		// Should show copy button but not export button
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.queryByTestId("export")).not.toBeInTheDocument()
	})

	it("hides action buttons in selection mode", () => {
		render(<TaskItemFooter item={mockItem} variant="full" isSelectionMode={true} />)

		// Should not show any action buttons
		expect(screen.queryByTestId("copy-prompt-button")).not.toBeInTheDocument()
		expect(screen.queryByTestId("export")).not.toBeInTheDocument()
		expect(screen.queryByTestId("delete-task-button")).not.toBeInTheDocument()
	})

	it("shows delete button when not in selection mode and onDelete is provided", () => {
		render(<TaskItemFooter item={mockItem} variant="full" isSelectionMode={false} onDelete={vi.fn()} />)

		expect(screen.getByTestId("delete-task-button")).toBeInTheDocument()
	})

	it("does not show delete button in selection mode", () => {
		render(<TaskItemFooter item={mockItem} variant="full" isSelectionMode={true} onDelete={vi.fn()} />)

		expect(screen.queryByTestId("delete-task-button")).not.toBeInTheDocument()
	})

	it("does not show delete button when onDelete is not provided", () => {
		render(<TaskItemFooter item={mockItem} variant="full" isSelectionMode={false} />)

		expect(screen.queryByTestId("delete-task-button")).not.toBeInTheDocument()
	})

	it("shows subtask tag when isSubtask is true", () => {
		render(<TaskItemFooter item={mockItem} variant="full" isSubtask={true} />)

		expect(screen.getByText("history:subtaskTag")).toBeInTheDocument()
	})

	it("does not show subtask tag when isSubtask is false", () => {
		render(<TaskItemFooter item={mockItem} variant="full" isSubtask={false} />)

		expect(screen.queryByText("history:subtaskTag")).not.toBeInTheDocument()
	})

	it("shows the same summary as a subtask row: mode, outcome, cost and tokens of the whole tree", () => {
		render(
			<TaskItemFooter
				item={{
					...mockItem,
					mode: "orchestrator",
					status: "completed",
					totalCost: 0.21,
					subtree: { cost: 1.54, tokensIn: 3000, tokensOut: 400 },
				}}
				variant="full"
				detailsId="details-1"
			/>,
		)

		const details = screen.getByTestId("task-details")
		expect(details).toHaveAttribute("id", "details-1")
		expect(details).toHaveTextContent("Orchestrator")
		expect(screen.getByTestId("task-outcome-completed")).toBeInTheDocument()
		expect(screen.getByTestId("task-cost")).toHaveTextContent("$1.54")
		expect(screen.getByTestId("task-tokens")).toHaveTextContent("↑3000 ↓400")
	})
})
