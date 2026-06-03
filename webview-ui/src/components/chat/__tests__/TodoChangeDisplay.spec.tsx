import { render, screen } from "@/utils/test-utils"

import { TodoChangeDisplay } from "../TodoChangeDisplay"

// Deterministic, locale-independent formatting for assertions.
vi.mock("@src/utils/format", () => ({
	formatTimestamp: (ts: number) => `T(${ts})`,
	formatDuration: (ms: number) => `D(${ms})`,
}))

describe("TodoChangeDisplay", () => {
	it("renders a completion timestamp beside a finished (completed) todo entry", () => {
		render(
			<TodoChangeDisplay
				previousTodos={[]}
				newTodos={[
					{ id: "1", content: "Done item", status: "completed" },
					{ id: "2", content: "Active item", status: "in_progress" },
					{ id: "3", content: "Future item", status: "pending" },
				]}
				startTs={1000}
				endTs={5000}
			/>,
		)

		// Header timestamp + exactly one completed-entry timestamp share the start time.
		expect(screen.getAllByText("T(1000)")).toHaveLength(2)
	})

	it("does not render a timestamp beside unfinished todo entries", () => {
		render(
			<TodoChangeDisplay
				previousTodos={[]}
				newTodos={[
					{ id: "1", content: "Active item", status: "in_progress" },
					{ id: "2", content: "Future item", status: "pending" },
				]}
				startTs={1000}
				endTs={5000}
			/>,
		)

		// Only the header timestamp is present; no entry is finished.
		expect(screen.getAllByText("T(1000)")).toHaveLength(1)
	})

	it("renders an entry timestamp for a todo that just became completed in an update", () => {
		render(
			<TodoChangeDisplay
				previousTodos={[{ id: "1", content: "Task", status: "in_progress" }]}
				newTodos={[{ id: "1", content: "Task", status: "completed" }]}
				startTs={2000}
				endTs={6000}
			/>,
		)

		expect(screen.getByText("Task")).toBeInTheDocument()
		expect(screen.getAllByText("T(2000)")).toHaveLength(2)
	})

	it("does not render an entry timestamp when startTs is unknown", () => {
		render(
			<TodoChangeDisplay
				previousTodos={[]}
				newTodos={[{ id: "1", content: "Done item", status: "completed" }]}
			/>,
		)

		expect(screen.queryByText(/^T\(/)).not.toBeInTheDocument()
	})
})
