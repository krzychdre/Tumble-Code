import { render } from "@/utils/test-utils"

import UpdateTodoListToolBlock from "../UpdateTodoListToolBlock"

vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => <div>{markdown}</div>,
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
