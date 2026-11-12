import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import ChatHistoryItem from "../ChatHistoryItem.js"

const frame = (message: Omit<TUIMessage, "id">, expanded?: boolean) =>
	render(<ChatHistoryItem message={{ id: "1", ...message } as TUIMessage} expanded={expanded} />).lastFrame() ?? ""

const commandOutput = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n")

describe("ChatHistoryItem", () => {
	it.each<[TUIMessage["role"], string]>([
		["user", "❯"],
		["assistant", "●"],
		["system", ""],
	])("renders a %s message with its marker, tabs as four spaces and no carriage returns", (role, marker) => {
		const output = frame({ role, content: "Code:\r\n\tfunction() {\r\n\t\treturn;\r\n\t}" })

		expect(output).toContain(marker)
		expect(output).toContain("    function()")
		expect(output).toContain("        return;")
		expect(output).not.toMatch(/[\t\r]/)
	})

	it("shows … for an empty assistant message and nothing for an unknown role", () => {
		expect(frame({ role: "assistant", content: "" })).toContain("…")
		expect(frame({ role: "unknown" as TUIMessage["role"], content: "Test" })).toBe("")
	})

	it("shows a thinking body only when expanded", () => {
		const message = { role: "thinking" as const, content: "Weighing\r\n\tthe two options." }

		expect(frame(message)).toContain("∴")
		expect(frame(message)).not.toContain("Weighing")
		expect(frame(message, true)).toContain("    the two options.")
		expect(frame(message, true)).not.toMatch(/[\t\r]/)
	})

	describe("tool messages", () => {
		it("shows the todo list of update_todo_list", () => {
			const output = frame({
				role: "tool",
				toolName: "update_todo_list",
				content: "{}",
				todos: [
					{ id: "a", content: "Write the spec", status: "completed" },
					{ id: "b", content: "Run it", status: "pending" },
				],
			})

			expect(output).toContain("Write the spec")
			expect(output).toContain("Run it")
		})

		it("routes structured toolData to its renderer and forwards expanded", () => {
			const message = {
				role: "tool" as const,
				toolName: "execute_command",
				content: "raw",
				toolData: { tool: "execute_command", command: "cat f", output: commandOutput },
			}

			expect(frame(message)).toContain("Bash(cat f)")
			expect(frame(message)).toContain("+30 lines")
			expect(frame(message, true)).toContain("line 30")
			expect(frame(message, true)).not.toContain("+30 lines")
		})

		it("renders attempt_completion's result", () => {
			const result = "I've completed the task successfully."
			const output = frame({
				role: "tool",
				toolName: "attempt_completion",
				content: JSON.stringify({ tool: "attempt_completion", result }),
				toolData: { tool: "attempt_completion", result },
			})

			expect(output).toContain(result)
		})

		it("falls back to the generic row without toolData", () => {
			const plain = frame({ role: "tool", toolName: "test_tool", content: "Output\r\nwith\rCR" }, true)

			expect(plain).toContain("test_tool")
			expect(plain).not.toContain("\r")

			// The same row shape whether the content parses as JSON or not:
			// the generic row with the humanized tool name and the raw content
			const json = frame({ role: "tool", toolName: "readFile", content: JSON.stringify({ path: "src/a.ts" }) })

			expect(json).toContain("Read")
			expect(json).toContain('{"path":"src/a.ts"}')
			expect(json).not.toContain("Read(src/a.ts)")
		})
	})
})
