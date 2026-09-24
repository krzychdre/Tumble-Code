import { findLastNewTaskToolUse, formatSubtaskResult, hasToolResultFor } from "../delegationHistory"

const newTask = (id?: string) => ({ type: "tool_use", name: "new_task", id, input: {} })
const otherTool = (id: string) => ({ type: "tool_use", name: "read_file", id, input: {} })
const result = (toolUseId: string) => ({ type: "tool_result", tool_use_id: toolUseId, content: "ok" })
const text = (t: string) => ({ type: "text", text: t })

describe("findLastNewTaskToolUse", () => {
	it.each([
		{ name: "empty history", messages: [], expected: undefined },
		{
			name: "no assistant message",
			messages: [{ role: "user", content: [text("hi")] }],
			expected: undefined,
		},
		{
			name: "one delegation",
			messages: [
				{ role: "user", content: [text("do it")] },
				{ role: "assistant", content: [text("delegating"), newTask("tu-1")] },
			],
			expected: { toolUseId: "tu-1", messageIndex: 1 },
		},
		{
			name: "two delegations: the later one wins",
			messages: [
				{ role: "assistant", content: [newTask("tu-1")] },
				{ role: "user", content: [result("tu-1")] },
				{ role: "assistant", content: [newTask("tu-2")] },
				{ role: "user", content: [text("more")] },
			],
			expected: { toolUseId: "tu-2", messageIndex: 2 },
		},
		{
			name: "new_task after another tool in the same message",
			messages: [{ role: "assistant", content: [otherTool("tu-r"), newTask("tu-n")] }],
			expected: { toolUseId: "tu-n", messageIndex: 0 },
		},
		{
			name: "a new_task block inside a user message is ignored",
			messages: [{ role: "user", content: [newTask("tu-x")] }],
			expected: undefined,
		},
		{
			name: "string content is ignored",
			messages: [{ role: "assistant", content: "new_task" }],
			expected: undefined,
		},
		{
			name: "only the first new_task block of a message counts; without an id the scan moves to earlier messages",
			messages: [
				{ role: "assistant", content: [newTask("tu-old")] },
				{ role: "assistant", content: [newTask(undefined), newTask("tu-ignored")] },
			],
			expected: { toolUseId: "tu-old", messageIndex: 0 },
		},
	])("$name", ({ messages, expected }) => {
		expect(findLastNewTaskToolUse(messages)).toEqual(expected)
	})
})

describe("hasToolResultFor", () => {
	const history = [
		{ role: "assistant", content: [newTask("tu-1")] },
		{ role: "user", content: [text("unrelated")] },
		{ role: "user", content: [result("tu-1")] },
		{ role: "assistant", content: [result("tu-2")] },
		{ role: "user", content: "tu-3" },
	]

	it.each([
		{ name: "matching result after the start index", toolUseId: "tu-1", fromIndex: 0, expected: true },
		{ name: "start index exactly on the result", toolUseId: "tu-1", fromIndex: 2, expected: true },
		{ name: "result before the start index", toolUseId: "tu-1", fromIndex: 3, expected: false },
		{ name: "different tool_use_id", toolUseId: "tu-9", fromIndex: 0, expected: false },
		{ name: "tool_result inside an assistant message", toolUseId: "tu-2", fromIndex: 0, expected: false },
		{ name: "string content", toolUseId: "tu-3", fromIndex: 0, expected: false },
	])("$name", ({ toolUseId, fromIndex, expected }) => {
		expect(hasToolResultFor(history, toolUseId, fromIndex)).toBe(expected)
	})

	it("scans from the start when no index is given", () => {
		expect(hasToolResultFor(history, "tu-1")).toBe(true)
	})
})

describe("formatSubtaskResult", () => {
	it.each([
		{ childTaskId: "child-1", summary: "All done", expected: "Subtask child-1 completed.\n\nResult:\nAll done" },
		{ childTaskId: "c", summary: "", expected: "Subtask c completed.\n\nResult:\n" },
		{
			childTaskId: "c2",
			summary: "line 1\nline 2",
			expected: "Subtask c2 completed.\n\nResult:\nline 1\nline 2",
		},
	])("formats $childTaskId", ({ childTaskId, summary, expected }) => {
		expect(formatSubtaskResult(childTaskId, summary)).toBe(expected)
	})
})
