// §2.8 (ai_plans/2026-09-27_ui-modernization.md): the todo list header is a
// real <button> with aria-expanded/aria-controls, and a thin progress bar sits
// next to the "3/7" count.

import { render, screen, fireEvent } from "@/utils/test-utils"

import { TodoListDisplay } from "../TodoListDisplay"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const todos = [
	{ id: "1", content: "one", status: "completed" },
	{ id: "2", content: "two", status: "completed" },
	{ id: "3", content: "three", status: "completed" },
	{ id: "4", content: "four", status: "in_progress" },
	{ id: "5", content: "five", status: "pending" },
	{ id: "6", content: "six", status: "pending" },
	{ id: "7", content: "seven", status: "pending" },
]

describe("TodoListDisplay header", () => {
	it("is a real button that reports and toggles its expanded state", () => {
		render(<TodoListDisplay todos={todos} />)

		const header = screen.getByRole("button", { expanded: false })
		expect(header.tagName).toBe("BUTTON")
		expect(header).toHaveAttribute("type", "button")
		// Collapsed: the current todo is the label.
		expect(header).toHaveTextContent("four")

		fireEvent.click(header)

		expect(header).toHaveAttribute("aria-expanded", "true")
		const listId = header.getAttribute("aria-controls")
		expect(listId).toBeTruthy()
		expect(document.getElementById(listId!)?.tagName).toBe("UL")
		expect(screen.getByText("seven")).toBeInTheDocument()
	})

	it("shows the count with a thin progress bar next to it, collapsed and expanded", () => {
		render(<TodoListDisplay todos={todos} />)

		const check = () => {
			expect(screen.getByText("3/7")).toBeInTheDocument()
			const bar = screen.getByRole("progressbar")
			expect(bar).toHaveAttribute("aria-valuenow", "3")
			expect(bar).toHaveAttribute("aria-valuemin", "0")
			expect(bar).toHaveAttribute("aria-valuemax", "7")
			expect(bar).toHaveAttribute("aria-label", 'chat:todo.partial:{"completed":3,"total":7}')
			// jsdom does not resolve custom properties, so assert the raw style attribute.
			expect(bar.querySelector("[data-todo-progress-fill]")?.getAttribute("style")).toContain(
				`width: ${(3 / 7) * 100}%`,
			)
		}

		check()
		fireEvent.click(screen.getByRole("button", { expanded: false }))
		check()
	})

	it("labels a fully done list through i18n and fills the bar", () => {
		const done = todos.map((todo) => ({ ...todo, status: "completed" }))
		render(<TodoListDisplay todos={done} />)

		expect(screen.getByRole("button", { expanded: false })).toHaveTextContent('chat:todo.complete:{"total":7}')
		expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "7")
	})
})
