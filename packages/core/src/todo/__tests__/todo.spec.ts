// npx vitest run src/todo/__tests__/todo.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { getLatestTodo } from "../todo.js"

const todo = (content: string) => ({ id: content, content, status: "pending" as const })

const toolAsk = (ts: number, payload: unknown): ClineMessage => ({
	ts,
	type: "ask",
	ask: "tool",
	text: typeof payload === "string" ? payload : JSON.stringify(payload),
})

const userEdit = (ts: number, todos: unknown[]): ClineMessage => ({
	ts,
	type: "say",
	say: "user_edit_todos",
	text: JSON.stringify({ tool: "updateTodoList", todos }),
})

describe("getLatestTodo", () => {
	it("returns an empty list when no message carries todos", () => {
		expect(getLatestTodo([])).toEqual([])
		expect(
			getLatestTodo([
				{ ts: 1, type: "say", say: "text", text: "hello" },
				toolAsk(2, { tool: "readFile", path: "a.ts" }),
			]),
		).toEqual([])
	})

	it("returns the todos of the latest updateTodoList ask", () => {
		const messages = [
			toolAsk(1, { tool: "updateTodoList", todos: [todo("first")] }),
			toolAsk(2, { tool: "readFile", path: "a.ts" }),
			toolAsk(3, { tool: "updateTodoList", todos: [todo("second")] }),
			toolAsk(4, { tool: "readFile", path: "b.ts" }),
		]

		expect(getLatestTodo(messages)).toEqual([todo("second")])
	})

	it("counts a user_edit_todos say as an update", () => {
		const messages = [
			toolAsk(1, { tool: "updateTodoList", todos: [todo("model")] }),
			userEdit(2, [todo("user")]),
		]

		expect(getLatestTodo(messages)).toEqual([todo("user")])
	})

	it("returns an empty todo list when the latest update cleared it", () => {
		const messages = [
			toolAsk(1, { tool: "updateTodoList", todos: [todo("model")] }),
			toolAsk(2, { tool: "updateTodoList", todos: [] }),
		]

		expect(getLatestTodo(messages)).toEqual([])
	})

	it("ignores updateTodoList payloads in other message kinds", () => {
		const payload = JSON.stringify({ tool: "updateTodoList", todos: [todo("ignored")] })
		const messages: ClineMessage[] = [
			toolAsk(1, { tool: "updateTodoList", todos: [todo("kept")] }),
			{ ts: 2, type: "say", say: "tool", text: payload },
			{ ts: 3, type: "ask", ask: "followup", text: payload },
			{ ts: 4, type: "say", say: "text", text: payload },
		]

		expect(getLatestTodo(messages)).toEqual([todo("kept")])
	})

	it("skips malformed, empty and non-list payloads", () => {
		const messages: ClineMessage[] = [
			toolAsk(1, { tool: "updateTodoList", todos: [todo("kept")] }),
			toolAsk(2, "{not json"),
			toolAsk(3, ""),
			{ ts: 4, type: "ask", ask: "tool" },
			toolAsk(5, "null"),
			toolAsk(6, "42"),
			toolAsk(7, { tool: "updateTodoList", todos: "not a list" }),
			toolAsk(8, { tool: "updateTodoList" }),
		]

		expect(getLatestTodo(messages)).toEqual([todo("kept")])
	})

	it("parses only the messages after the latest update", () => {
		const messages = [
			...Array.from({ length: 50 }, (_, i) => toolAsk(i, { tool: "readFile", path: `${i}.ts` })),
			toolAsk(100, { tool: "updateTodoList", todos: [todo("latest")] }),
			toolAsk(101, { tool: "readFile", path: "after.ts" }),
		]
		const parse = vi.spyOn(JSON, "parse")
		onTestFinished(() => parse.mockRestore())

		expect(getLatestTodo(messages)).toEqual([todo("latest")])
		expect(parse).toHaveBeenCalledTimes(2)
	})

	it("parses through the given parser", () => {
		const parsed = { tool: "updateTodoList", todos: [todo("from parser")] }
		const parseTool = vi.fn(() => parsed)

		expect(getLatestTodo([toolAsk(1, "ignored by the fake parser")], parseTool)).toEqual([todo("from parser")])
		expect(parseTool).toHaveBeenCalledTimes(1)
	})
})
