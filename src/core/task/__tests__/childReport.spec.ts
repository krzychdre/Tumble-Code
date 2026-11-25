// cd src && ./node_modules/.bin/vitest run core/task/__tests__/childReport.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { childReportNotes } from "../childReport"

const say = (sayType: ClineMessage["say"], text: string): ClineMessage => ({ ts: 1, type: "say", say: sayType, text })

describe("childReportNotes", () => {
	it("is empty when the user did not write to the child and it did not hand over", () => {
		const child = { clineMessages: [say("text", "working"), say("user_feedback", "  ")], contextHandoff: false }
		expect(childReportNotes(child)).toBe("")
	})

	it("quotes every message the user wrote to the child, in order, as binding for the parent", () => {
		const notes = childReportNotes({
			clineMessages: [
				say("text", "the assignment"),
				say("user_feedback", "use tabs"),
				say("completion_result", "done"),
				say("user_feedback", "we stop for today"),
			],
			contextHandoff: false,
		})

		expect(notes).toContain("they apply to you too")
		expect(notes).toContain(
			"<user_message>\nuse tabs\n</user_message>\n\n<user_message>\nwe stop for today\n</user_message>",
		)
		expect(notes).toContain("do not start new work")
		expect(notes).not.toContain("the assignment")
		expect(notes).not.toContain("done")
		expect(notes).not.toContain("handed its work over")
	})

	it("after a handoff at the context limit lists the TODO items left open and asks for a new subtask", () => {
		const notes = childReportNotes({
			clineMessages: [],
			todoList: [
				{ id: "1", content: "write the parser", status: "completed" },
				{ id: "2", content: "wire it into main", status: "in_progress" },
				{ id: "3", content: "run the build", status: "pending" },
			],
			contextHandoff: true,
		})

		expect(notes).toContain("handed its work over. This is planned, not a failure")
		expect(notes).toContain("TODO items it left open:\n\n- wire it into main\n- run the build")
		expect(notes).not.toContain("write the parser")
		expect(notes).toContain("Start a new subtask for the work that is left")
	})
})
