// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/latestTodos.spec.ts

import type { ClineMessage, TodoItem } from "@roo-code/types"

import { selectLatestTodos } from "../latestTodos"

const todo = (content: string): TodoItem => ({ id: content, content, status: "pending" })

// The parse cache is module state shared by every test here, so each test uses
// its own ts range.
const toolAsk = (ts: number, payload: unknown): ClineMessage => ({
	ts,
	type: "ask",
	ask: "tool",
	text: typeof payload === "string" ? payload : JSON.stringify(payload),
})

const userEdit = (ts: number, todos: TodoItem[]): ClineMessage => ({
	ts,
	type: "say",
	say: "user_edit_todos",
	text: JSON.stringify({ tool: "updateTodoList", todos }),
})

describe("selectLatestTodos", () => {
	it("returns the todos of the latest updateTodoList ask", () => {
		const messages = [
			toolAsk(100, { tool: "updateTodoList", todos: [todo("first")] }),
			toolAsk(101, { tool: "readFile", path: "a.ts" }),
			toolAsk(102, { tool: "updateTodoList", todos: [todo("second")] }),
			toolAsk(103, { tool: "readFile", path: "b.ts" }),
		]

		expect(selectLatestTodos(messages, undefined)).toEqual([todo("second")])
	})

	it("counts a user_edit_todos say as an update", () => {
		const messages = [toolAsk(200, { tool: "updateTodoList", todos: [todo("model")] }), userEdit(201, [todo("user")])]

		expect(selectLatestTodos(messages, undefined)).toEqual([todo("user")])
	})

	it("skips malformed and non-list payloads and other message kinds", () => {
		const payload = JSON.stringify({ tool: "updateTodoList", todos: [todo("ignored")] })
		const messages: ClineMessage[] = [
			toolAsk(300, { tool: "updateTodoList", todos: [todo("kept")] }),
			toolAsk(301, "{not json"),
			toolAsk(302, ""),
			{ ts: 303, type: "ask", ask: "tool" },
			toolAsk(304, "null"),
			toolAsk(305, { tool: "updateTodoList", todos: "not a list" }),
			{ ts: 306, type: "say", say: "tool", text: payload },
			{ ts: 307, type: "say", say: "text", text: payload },
		]

		expect(selectLatestTodos(messages, undefined)).toEqual([todo("kept")])
	})

	it("returns an empty list when the history has no todos", () => {
		expect(selectLatestTodos([toolAsk(400, { tool: "readFile", path: "a.ts" })], undefined)).toEqual([])
		expect(selectLatestTodos([], [])).toEqual([])
	})

	it("shows the task's initial todos until the history has a non-empty list", () => {
		const initial = [todo("initial")]

		expect(selectLatestTodos([toolAsk(500, { tool: "readFile", path: "a.ts" })], initial)).toBe(initial)
		expect(selectLatestTodos([toolAsk(501, { tool: "updateTodoList", todos: [] })], initial)).toBe(initial)
		expect(selectLatestTodos([toolAsk(502, { tool: "updateTodoList", todos: [todo("new")] })], initial)).toEqual([
			todo("new"),
		])
	})

	it("does not parse an unchanged history again (one streamed token)", () => {
		const history: ClineMessage[] = [
			toolAsk(600, { tool: "updateTodoList", todos: [todo("old")] }),
			...Array.from({ length: 200 }, (_, i) => toolAsk(601 + i, { tool: "readFile", path: `${i}.ts` })),
		]
		expect(selectLatestTodos(history, undefined)).toEqual([todo("old")])

		// The next token: a copy of the same history plus a growing text message,
		// as the chat sees it on every streamed token.
		const next = [...history, { ts: 900, type: "say", say: "text", text: "partial answ", partial: true } as const]
		const parse = vi.spyOn(JSON, "parse")
		onTestFinished(() => parse.mockRestore())

		expect(selectLatestTodos(next, undefined)).toEqual([todo("old")])
		expect(parse).not.toHaveBeenCalled()
	})
})
