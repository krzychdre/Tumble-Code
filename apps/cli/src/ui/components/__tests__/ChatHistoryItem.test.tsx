import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import ChatHistoryItem from "../ChatHistoryItem.js"

describe("ChatHistoryItem", () => {
	describe("content sanitization", () => {
		it("sanitizes tabs in user messages", () => {
			const message: TUIMessage = {
				id: "1",
				role: "user",
				content: "function test() {\n\treturn true;\n}",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("function test() {")
			expect(output).toContain("    return true;") // Tab replaced with 4 spaces
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in assistant messages", () => {
			const message: TUIMessage = {
				id: "2",
				role: "assistant",
				content: "Here's the code:\n\tconst x = 1;",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    const x = 1;")
			expect(output).not.toContain("\t")
		})

		it("renders thinking header without showing content (collapsed)", () => {
			const message: TUIMessage = {
				id: "3",
				role: "thinking",
				content: "Looking at:\n\tMarkdown example:\n\t```ts\n\t\tfunction foo() {}\n\t```",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Collapsed thinking shows the header, not the content
			expect(output).toContain("Thinking")
			expect(output).not.toContain("\t")
			// Content should NOT be shown in collapsed mode
			expect(output).not.toContain("Markdown example:")
			expect(output).not.toContain("function foo() {}")
		})

		it("sanitizes tabs in tool messages with parsed content", () => {
			// Tool messages parse JSON content to extract fields like 'content'.
			// Use execute_command so the output is rendered via ResultRow
			// (read_file shows "Read N lines" summary, not the raw content).
			const message: TUIMessage = {
				id: "4",
				role: "tool",
				content: JSON.stringify({
					tool: "execute_command",
					command: "cat test.js",
					output: "function() {\n\treturn true;\n}",
				}),
				toolName: "execute_command",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// The output inside the JSON should be sanitized
			expect(output).toContain("    return true;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in tool messages with structured toolData output", () => {
			const message: TUIMessage = {
				id: "5",
				role: "tool",
				content: "raw content",
				toolName: "execute_command",
				toolData: {
					tool: "execute_command",
					command: "ls",
					output: "function() {\n\treturn;\n}",
				},
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    return;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in system messages", () => {
			const message: TUIMessage = {
				id: "6",
				role: "system",
				content: "System info:\n\tCPU: high",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    CPU: high")
			expect(output).not.toContain("\t")
		})

		it("strips carriage returns from content", () => {
			const message: TUIMessage = {
				id: "7",
				role: "thinking",
				content: "Line 1\r\nLine 2\rLine 3",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Carriage returns should be stripped (content not shown, but no crash)
			expect(output).not.toContain("\r")
			expect(output).toContain("Thinking")
		})

		it("strips carriage returns from tool content", () => {
			const message: TUIMessage = {
				id: "8",
				role: "tool",
				content: "Output\r\nwith\rCR",
				toolName: "test_tool",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).not.toContain("\r")
		})

		it("handles content with both tabs and carriage returns", () => {
			const message: TUIMessage = {
				id: "9",
				role: "assistant",
				content: "Code:\r\n\tfunction() {\r\n\t\treturn;\r\n\t}",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).not.toContain("\t")
			expect(output).not.toContain("\r")
			expect(output).toContain("    function()")
			expect(output).toContain("        return;") // Double-indented
		})
	})

	describe("message rendering", () => {
		it("renders user messages with pointer and text", () => {
			const message: TUIMessage = {
				id: "1",
				role: "user",
				content: "Hello",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// New grammar: pointer ❯ on bg band + text (no "You said:")
			expect(output).toContain("❯")
			expect(output).toContain("Hello")
			expect(output).not.toContain("You said:")
		})

		it("renders assistant messages with bullet and text", () => {
			const message: TUIMessage = {
				id: "2",
				role: "assistant",
				content: "Hi there",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// New grammar: ● bullet + text (no "Tumble said:")
			expect(output).toContain("●")
			expect(output).toContain("Hi there")
			expect(output).not.toContain("Tumble said:")
		})

		it("renders thinking messages collapsed (header only, no content)", () => {
			const message: TUIMessage = {
				id: "3",
				role: "thinking",
				content: "Let me think...",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Collapsed thinking shows the ∴ Thinking… header, not the content
			expect(output).toContain("Thinking")
			expect(output).toContain("∴")
			// Content is no longer shown
			expect(output).not.toContain("Let me think...")
		})

		it("renders tool messages with Read display name and path", () => {
			const message: TUIMessage = {
				id: "4",
				role: "tool",
				content: JSON.stringify({
					tool: "read_file",
					path: "test.txt",
					content: "line one\nline two\nline three",
				}),
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// New grammar: ● Read(path) + ⎿ result
			expect(output).toContain("Read")
			expect(output).toContain("test.txt")
			expect(output).toContain("⎿")
		})

		it("renders tool messages with path for file tools", () => {
			const message: TUIMessage = {
				id: "5",
				role: "tool",
				content: JSON.stringify({ tool: "read_file", path: "src/test.ts", content: "file content" }),
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("Read")
			expect(output).toContain("src/test.ts")
		})

		it("renders tool messages with List display name for list tools", () => {
			const message: TUIMessage = {
				id: "6",
				role: "tool",
				content: JSON.stringify({ tool: "listFilesRecursive", path: "src/", content: "file1\nfile2" }),
				toolName: "listFilesRecursive",
				toolDisplayName: "List Files",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("List")
			expect(output).toContain("src/")
		})

		it("shows outside workspace badge when applicable", () => {
			const message: TUIMessage = {
				id: "7",
				role: "tool",
				content: JSON.stringify({
					tool: "read_file",
					path: "/etc/hosts",
					isOutsideWorkspace: true,
					content: "hosts file",
				}),
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("outside workspace")
		})

		it("uses fallback content when message.content is empty (assistant → …)", () => {
			const message: TUIMessage = {
				id: "8",
				role: "assistant",
				content: "",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("…")
		})

		it("returns null for unknown role", () => {
			const message = {
				id: "9",
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				role: "unknown" as any,
				content: "Test",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			expect(lastFrame()).toBe("")
		})

		it("renders command tools with Bash display name", () => {
			const message: TUIMessage = {
				id: "10",
				role: "tool",
				content: JSON.stringify({ tool: "execute_command" }),
				toolName: "execute_command",
				toolDisplayName: "Execute Command",
				toolDisplayOutput: "command output",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// New grammar: ● Bash + ⎿ output
			expect(output).toContain("Bash")
		})

		it("renders search tools with Search display name", () => {
			const message: TUIMessage = {
				id: "11",
				role: "tool",
				content: JSON.stringify({ tool: "search_files" }),
				toolName: "search_files",
				toolDisplayName: "Search Files",
				toolDisplayOutput: "search results",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("Search")
		})

		it("renders attempt_completion tool with CompletionTool renderer", () => {
			const message: TUIMessage = {
				id: "12",
				role: "tool",
				content: JSON.stringify({
					tool: "attempt_completion",
					result: "I've completed the task successfully.",
				}),
				toolName: "attempt_completion",
				toolDisplayName: "Task Complete",
				toolDisplayOutput: "✅ I've completed the task successfully.",
				toolData: {
					tool: "attempt_completion",
					result: "I've completed the task successfully.",
				},
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// CompletionTool renders the result content via Markdown with a bullet
			expect(output).toContain("I've completed the task successfully.")
		})

		it("forwards content and expanded to the thinking renderer", () => {
			const message: TUIMessage = {
				id: "14",
				role: "thinking",
				content: "Weighing the two options.",
			}

			const collapsed = render(<ChatHistoryItem message={message} />).lastFrame()
			const expanded = render(<ChatHistoryItem message={message} expanded={true} />).lastFrame()

			expect(collapsed).not.toContain("Weighing the two options.")
			expect(expanded).toContain("Weighing the two options.")
		})

		it("forwards expanded to tool renderers", () => {
			const message: TUIMessage = {
				id: "15",
				role: "tool",
				content: "raw content",
				toolName: "execute_command",
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"),
				},
			}

			const collapsed = render(<ChatHistoryItem message={message} />).lastFrame()
			const expanded = render(<ChatHistoryItem message={message} expanded={true} />).lastFrame()

			expect(collapsed).toContain("+25 lines")
			expect(collapsed).not.toContain("line 6")
			expect(expanded).toContain("line 30")
			expect(expanded).not.toContain("+25 lines")
		})

		it("forwards expanded to tool renderers resolved from raw JSON content", () => {
			const message: TUIMessage = {
				id: "16",
				role: "tool",
				content: JSON.stringify({
					tool: "execute_command",
					command: "cat longfile.txt",
					output: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"),
				}),
				toolName: "execute_command",
			}

			const expanded = render(<ChatHistoryItem message={message} expanded={true} />).lastFrame()

			expect(expanded).toContain("line 30")
			expect(expanded).not.toContain("+20 lines")
		})

		it("renders ask_followup_question tool with CompletionTool renderer", () => {
			const message: TUIMessage = {
				id: "13",
				role: "tool",
				content: JSON.stringify({ tool: "ask_followup_question", question: "What color would you like?" }),
				toolName: "ask_followup_question",
				toolDisplayName: "Question",
				toolDisplayOutput: "❓ What color would you like?",
				toolData: {
					tool: "ask_followup_question",
					question: "What color would you like?",
				},
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// CompletionTool renders the question content via Markdown
			expect(output).toContain("What color would you like?")
		})
	})
})
