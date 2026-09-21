import { render } from "ink-testing-library"

import type { TodoItem } from "@roo-code/types"

import TodoDisplay from "../TodoDisplay.js"

describe("TodoDisplay", () => {
	const mockTodos: TodoItem[] = [
		{ id: "1", content: "Analyze requirements", status: "completed" },
		{ id: "2", content: "Design architecture", status: "completed" },
		{ id: "3", content: "Implement core logic", status: "in_progress" },
		{ id: "4", content: "Write tests", status: "pending" },
		{ id: "5", content: "Update documentation", status: "pending" },
	]

	it("renders all todos with correct checkbox glyphs", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} />)
		const output = lastFrame()

		// Check header (default title is "Update Todos")
		expect(output).toContain("Update Todos")

		// Check all items are rendered
		expect(output).toContain("Analyze requirements")
		expect(output).toContain("Design architecture")
		expect(output).toContain("Implement core logic")
		expect(output).toContain("Write tests")
		expect(output).toContain("Update documentation")

		// Check checkbox glyphs are present
		expect(output).toContain("☒") // completed (checkboxOn)
		expect(output).toContain("☐") // pending / in_progress (checkboxOff)
	})

	it("renders progress bar when showProgress is true", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} showProgress={true} />)
		const output = lastFrame()

		// The mini-bar shows completed/total and a █/░ bar (no percentage).
		// 2/5 completed → round(2/5 * 16) = 6 filled blocks, 10 empty.
		expect(output).toContain("(2/5)")
		expect(output).toContain("█".repeat(6))
		expect(output).toContain("░".repeat(10))
	})

	it("hides progress bar when showProgress is false", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} showProgress={false} />)
		const output = lastFrame()

		// Should not show completion stats
		expect(output).not.toContain("2/5 completed")
	})

	it("returns null for empty todos array", () => {
		const { lastFrame } = render(<TodoDisplay todos={[]} />)
		expect(lastFrame()).toBe("")
	})

	it("shows only changed items when showChangesOnly is true", () => {
		const previousTodos: TodoItem[] = [
			{ id: "1", content: "Analyze requirements", status: "completed" },
			{ id: "2", content: "Design architecture", status: "in_progress" },
			{ id: "3", content: "Implement core logic", status: "pending" },
		]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Analyze requirements", status: "completed" },
			{ id: "2", content: "Design architecture", status: "completed" }, // Changed
			{ id: "3", content: "Implement core logic", status: "in_progress" }, // Changed
		]

		const { lastFrame } = render(
			<TodoDisplay todos={newTodos} previousTodos={previousTodos} showChangesOnly={true} />,
		)
		const output = lastFrame()

		// Should show changed items
		expect(output).toContain("Design architecture")
		expect(output).toContain("Implement core logic")
	})

	it("shows change labels for items that changed status", () => {
		const previousTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "pending" },
			{ id: "2", content: "Task 2", status: "in_progress" },
		]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "in_progress" },
			{ id: "2", content: "Task 2", status: "completed" },
		]

		const { lastFrame } = render(<TodoDisplay todos={newTodos} previousTodos={previousTodos} />)
		const output = lastFrame()

		// Check change indicators
		expect(output).toContain("[started]")
		expect(output).toContain("[done]")
	})

	it("shows [new] label for new items", () => {
		const previousTodos: TodoItem[] = [{ id: "1", content: "Task 1", status: "completed" }]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "New Task", status: "pending" },
		]

		const { lastFrame } = render(<TodoDisplay todos={newTodos} previousTodos={previousTodos} />)
		const output = lastFrame()

		expect(output).toContain("New Task")
		expect(output).toContain("[new]")
	})

	it("uses custom title when provided", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} title="My Custom Title" />)
		const output = lastFrame()

		expect(output).toContain("My Custom Title")
	})

	it("calculates in_progress count correctly", () => {
		const todosWithMultipleInProgress: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "Task 2", status: "in_progress" },
			{ id: "3", content: "Task 3", status: "in_progress" },
			{ id: "4", content: "Task 4", status: "pending" },
		]

		const { lastFrame } = render(<TodoDisplay todos={todosWithMultipleInProgress} showProgress={true} />)
		const output = lastFrame()

		// 1/4 completed → round(1/4 * 16) = 4 filled blocks, 12 empty.
		expect(output).toContain("(1/4)")
		expect(output).toContain("█".repeat(4))
		expect(output).toContain("░".repeat(12))
		// In_progress items render with checkboxOff glyph and bold warning
		expect(output).toContain("☐") // checkboxOff for in_progress
	})
})
