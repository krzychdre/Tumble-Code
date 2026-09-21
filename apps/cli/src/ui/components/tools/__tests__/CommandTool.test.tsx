import { render } from "ink-testing-library"

import type { ToolRendererProps } from "../types.js"
import { CommandTool } from "../CommandTool.js"

describe("CommandTool", () => {
	describe("command display", () => {
		it("displays the command as Bash(command) when toolData.command is provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "npm test",
					output: "All tests passed",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// New grammar: ● Bash(command) — no $ prefix
			expect(output).toContain("Bash")
			expect(output).toContain("npm test")
			expect(output).not.toContain("$ npm test")
		})

		it("displays Bash without command arg when toolData.command is empty", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "",
					output: "All tests passed",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// Output should be displayed; no command arg shown
			expect(output).toContain("All tests passed")
			expect(output).toContain("Bash")
		})

		it("displays Bash without command arg when toolData.command is undefined", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					output: "All tests passed",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("All tests passed")
			expect(output).toContain("Bash")
		})

		it("displays command with complex arguments", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: 'git commit -m "fix: resolve issue"',
					output: "[main abc123] fix: resolve issue",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("Bash")
			expect(output).toContain('git commit -m "fix: resolve issue"')
		})
	})

	describe("output display", () => {
		it("displays output when provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "echo hello",
					output: "hello",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("hello")
		})

		it("displays multi-line output", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "ls",
					output: "file1.txt\nfile2.txt\nfile3.txt",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("file1.txt")
			expect(output).toContain("file2.txt")
			expect(output).toContain("file3.txt")
		})

		it("uses content as fallback when output is not provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "ls",
					content: "fallback content",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("fallback content")
		})

		it("truncates output to MAX_OUTPUT_LINES", () => {
			// Create output with more than 10 lines (MAX_OUTPUT_LINES = 10)
			const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")

			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: longOutput,
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// First 10 lines should be visible
			expect(output).toContain("line 1")
			expect(output).toContain("line 10")

			// ResultRow uses "… +N lines" truncation indicator
			expect(output).toContain("+10 lines")
		})
	})

	describe("expanded mode", () => {
		const longOutput = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n")

		it("caps at 10 lines by default", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: longOutput,
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("line 10")
			expect(output).not.toContain("line 11")
			expect(output).toContain("+20 lines")
		})

		it("shows all output lines when expanded", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: longOutput,
				},
				expanded: true,
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("line 29")
			expect(output).toContain("line 30")
			expect(output).not.toContain("+20 lines")
			// The infinite cap must never leak into a marker
			expect(output).not.toContain("Infinity")
		})
	})

	describe("header display", () => {
		it("displays Bash display name when rendered", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "echo test",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("Bash")
			expect(output).toContain("echo test")
		})
	})
})
