import type { ClineMessage } from "@roo-code/types"

import { render } from "@/utils/test-utils"

import { UserEditTodosRow } from "../StatusRows"
import type { RowRendererProps } from "../../types"

// Counts the block's renders and breaks a render loop by throwing, so a
// regression fails the test instead of hanging the worker inside act().
const renders = vi.hoisted(() => ({ count: 0 }))
vi.mock("@src/components/chat/BlockTimestamp", () => ({
	BlockTimestamp: () => {
		renders.count++
		if (renders.count > 50) {
			throw new Error("render loop: the block rendered more than 50 times")
		}
		return null
	},
}))

const TS = 1_700_000_000_000

const props = (text: string | undefined): RowRendererProps => ({
	message: { type: "say", say: "user_edit_todos", ts: TS, text } as ClineMessage,
	isExpanded: false,
	isLast: false,
	isStreaming: false,
	toggleExpand: () => {},
	meta: { nextTs: TS + 900, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
})

// The payload UpdateTodoListTool says when the user changed the list in the approval dialog.
const payload = JSON.stringify({
	tool: "updateTodoList",
	todos: [
		{ id: "1", content: "Write the failing test", status: "completed" },
		{ id: "2", content: "Step the user added", status: "pending" },
	],
})

describe("UserEditTodosRow", () => {
	beforeEach(() => {
		renders.count = 0
	})

	it("shows the todos the user edited, taken from the message payload", () => {
		const { getByText } = render(<UserEditTodosRow {...props(payload)} />)
		expect(getByText("User Edit")).toBeInTheDocument()
		expect(getByText("Write the failing test")).toBeInTheDocument()
		expect(getByText("Step the user added")).toBeInTheDocument()
	})

	it("renders a bounded number of times", () => {
		render(<UserEditTodosRow {...props(payload)} />)
		expect(renders.count).toBeLessThanOrEqual(5)
	})

	it("still renders, without looping, when the payload is missing or unparsable", () => {
		for (const text of [undefined, "{oops", "[]"]) {
			renders.count = 0
			const { getByText, unmount } = render(<UserEditTodosRow {...props(text)} />)
			expect(getByText("User Edit")).toBeInTheDocument()
			expect(renders.count).toBeLessThanOrEqual(5)
			unmount()
		}
	})
})
