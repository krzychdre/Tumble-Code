import { render, screen, fireEvent } from "@/utils/test-utils"

import UpdateTodoListToolBlock from "../UpdateTodoListToolBlock"

vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => <div>{markdown}</div>,
}))

// Counts the block's renders (it renders one BlockTimestamp per render when
// given startTs) and breaks a render loop by throwing, so a regression fails
// the test instead of hanging the worker inside act().
const renders = vi.hoisted(() => ({ count: 0 }))
vi.mock("../BlockTimestamp", () => ({
	BlockTimestamp: () => {
		renders.count++
		if (renders.count > 50) {
			throw new Error("render loop: the block rendered more than 50 times")
		}
		return null
	},
}))

const MISSING_ON_CHANGE =
	"UpdateTodoListToolBlock: onChange callback not passed, cannot notify model after todo changes!"

const todos = [{ id: "1", content: "Write the spec", status: "in_progress" }]

describe("UpdateTodoListToolBlock onChange check", () => {
	let warn: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		warn.mockRestore()
	})

	const missingWarnings = () => warn.mock.calls.filter((args: unknown[]) => args[0] === MISSING_ON_CHANGE)

	it("warns once when mounted without onChange, not again on later renders", () => {
		const { rerender } = render(<UpdateTodoListToolBlock todos={todos} onChange={undefined as any} />)
		expect(missingWarnings()).toHaveLength(1)

		rerender(<UpdateTodoListToolBlock todos={[...todos]} onChange={undefined as any} />)
		rerender(<UpdateTodoListToolBlock todos={todos} onChange={null as any} />)
		expect(missingWarnings()).toHaveLength(1)
	})

	it("does not warn when mounted with onChange, even if a parent passes a new one each render", () => {
		const { rerender } = render(<UpdateTodoListToolBlock todos={todos} onChange={vi.fn()} />)
		rerender(<UpdateTodoListToolBlock todos={todos} onChange={vi.fn()} />)
		expect(missingWarnings()).toHaveLength(0)
	})

	it("checks only the mount: losing onChange later does not warn", () => {
		const { rerender } = render(<UpdateTodoListToolBlock todos={todos} onChange={vi.fn()} />)
		rerender(<UpdateTodoListToolBlock todos={todos} onChange={undefined as any} />)
		expect(missingWarnings()).toHaveLength(0)
	})
})

describe("UpdateTodoListToolBlock without a todos prop", () => {
	beforeEach(() => {
		renders.count = 0
	})

	// The `todos = []` default used to be a new array on every render, and the
	// effect that syncs editTodos from `todos` is keyed on it, so each render set
	// state and scheduled the next one.
	it("renders a bounded number of times in the user-edit variant", () => {
		render(<UpdateTodoListToolBlock userEdited onChange={() => {}} startTs={1} />)
		expect(renders.count).toBeLessThanOrEqual(5)
	})

	it("renders a bounded number of times in the editable variant", () => {
		render(<UpdateTodoListToolBlock onChange={() => {}} startTs={1} content="plain" />)
		expect(renders.count).toBeLessThanOrEqual(5)
	})
})

describe("UpdateTodoListToolBlock user-edit variant", () => {
	it("lists the todos the user edited, with their status", () => {
		const { getByText, queryByRole } = render(
			<UpdateTodoListToolBlock
				userEdited
				onChange={() => {}}
				todos={[
					{ id: "a", content: "Renamed by the user", status: "completed" },
					{ id: "b", content: "Added by the user", status: "" },
				]}
			/>,
		)
		expect(getByText("chat:todo.userEdit")).toBeInTheDocument()
		expect(getByText("Renamed by the user")).toBeInTheDocument()
		expect(getByText("Added by the user")).toBeInTheDocument()
		// Read-only: the approval is over, so there is nothing to edit here.
		expect(queryByRole("button", { name: "chat:todo.edit" })).toBeNull()
		expect(queryByRole("textbox")).toBeNull()
	})
})

// §2.8 (ai_plans/2026-09-27_ui-modernization.md): the block's 32 inline style
// objects moved to classes (theme colours instead of hex literals, no leaked
// radii). Every state is checked: read-only, user edit, editing, adding a
// todo and the delete confirmation.
describe("UpdateTodoListToolBlock styling", () => {
	const mixed = [
		{ id: "a", content: "Done thing", status: "completed" },
		{ id: "b", content: "Current thing", status: "in_progress" },
		{ id: "c", content: "Later thing", status: "" },
	]
	const inlineStyled = (container: HTMLElement) =>
		Array.from(container.querySelectorAll("[style]")).map((el) => el.outerHTML.slice(0, 120))

	it("renders the read-only and user-edit variants without inline styles", () => {
		const readOnly = render(<UpdateTodoListToolBlock todos={mixed} onChange={vi.fn()} editable={false} />)
		expect(inlineStyled(readOnly.container)).toEqual([])
		readOnly.unmount()

		const userEdit = render(<UpdateTodoListToolBlock todos={mixed} onChange={vi.fn()} userEdited />)
		expect(inlineStyled(userEdit.container)).toEqual([])
	})

	it("renders editing, adding and the delete confirmation without inline styles", () => {
		const { container } = render(<UpdateTodoListToolBlock todos={mixed} onChange={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "chat:todo.edit" }))
		expect(inlineStyled(container)).toEqual([])

		fireEvent.click(screen.getByRole("button", { name: "+ chat:todo.addTodo" }))
		expect(inlineStyled(container)).toEqual([])

		fireEvent.click(screen.getAllByRole("button", { name: "chat:todo.remove" })[0])
		expect(screen.getByText("chat:todo.deleteConfirm")).toBeInTheDocument()
		expect(inlineStyled(container)).toEqual([])
	})

	it("marks each todo's status dot with a data attribute", () => {
		const { container } = render(<UpdateTodoListToolBlock todos={mixed} onChange={vi.fn()} editable={false} />)

		const dots = Array.from(container.querySelectorAll("[data-todo-status]")).map((el) =>
			el.getAttribute("data-todo-status"),
		)
		expect(dots).toEqual(["completed", "in_progress", "pending"])
	})

	it("keeps editing working: removing a todo after confirmation notifies onChange", () => {
		const onChange = vi.fn()
		render(<UpdateTodoListToolBlock todos={mixed} onChange={onChange} />)

		fireEvent.click(screen.getByRole("button", { name: "chat:todo.edit" }))
		fireEvent.click(screen.getAllByRole("button", { name: "chat:todo.remove" })[0])
		fireEvent.click(screen.getByRole("button", { name: "chat:todo.delete" }))

		expect(onChange).toHaveBeenLastCalledWith([
			expect.objectContaining({ id: "b" }),
			expect.objectContaining({ id: "c" }),
		])
	})
})
