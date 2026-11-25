// cd src && ./node_modules/.bin/vitest run core/task/__tests__/childReport.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { childReportNotes } from "../childReport"

const say = (sayType: ClineMessage["say"], text: string): ClineMessage => ({ ts: 1, type: "say", say: sayType, text })

describe("childReportNotes", () => {
	it("is empty when the user did not write to the child", () => {
		expect(childReportNotes({ clineMessages: [say("text", "working"), say("user_feedback", "  ")] })).toBe("")
	})

	it("quotes every message the user wrote to the child, in order, as binding for the parent", () => {
		const notes = childReportNotes({
			clineMessages: [
				say("text", "the assignment"),
				say("user_feedback", "use tabs"),
				say("completion_result", "done"),
				say("user_feedback", "we stop for today"),
			],
		})

		expect(notes).toContain("they apply to you too")
		expect(notes).toContain(
			"<user_message>\nuse tabs\n</user_message>\n\n<user_message>\nwe stop for today\n</user_message>",
		)
		expect(notes).toContain("do not start new work")
		expect(notes).not.toContain("the assignment")
		expect(notes).not.toContain("done")
	})
})
