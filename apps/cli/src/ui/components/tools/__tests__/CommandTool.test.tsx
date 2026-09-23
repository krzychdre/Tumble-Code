import { render } from "ink-testing-library"
import stringWidth from "string-width"

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

			// No command arg shown; the collapsed row counts the output
			expect(output).toContain("Bash")
			expect(output).not.toContain("Bash(")
			expect(output).toContain("+1 line (ctrl+o)")
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

			expect(output).toContain("Bash")
			expect(output).not.toContain("Bash(")
			expect(output).toContain("+1 line (ctrl+o)")
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
		it("hides the output behind a line counter when collapsed", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"),
				},
			}

			const rows = (render(<CommandTool {...props} />).lastFrame() ?? "").split("\n")

			// The header and the counter, nothing of the output itself.
			expect(rows).toHaveLength(2)
			expect(rows[0]).toContain("Bash(cat longfile.txt)")
			expect(rows[1]).toMatch(/^ {4}⎿ {2}… \+20 lines \(ctrl\+o\)$/)
		})

		it("prints no counter for a command without output", () => {
			const output = render(<CommandTool toolData={{ tool: "execute_command", command: "true" }} />).lastFrame()

			expect(output?.split("\n")).toHaveLength(1)
			expect(output).not.toContain("⎿")
		})

		it("displays output when provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "echo hello",
					output: "hello",
				},
				expanded: true,
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output?.split("\n")[1]).toContain("hello")
		})

		it("displays multi-line output", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "ls",
					output: "file1.txt\nfile2.txt\nfile3.txt",
				},
				expanded: true,
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
				expanded: true,
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("fallback content")
		})

		it("does not count a trailing newline as a line of output", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "grep -n torch.save train_gpt.py",
					output: "2749:    torch.save(log, path)\n",
				},
			}

			const output = render(<CommandTool {...props} />).lastFrame()

			expect(output).toContain("+1 line (ctrl+o)")
			expect(output).not.toContain("+2 lines")
		})
	})

	// ink-testing-library renders at 100 columns. A row one column wider wraps
	// in a real terminal onto a row ink does not count, which the live tail
	// then fails to erase (plan: 2026-09-22 cli bash row overflows width).
	describe("row geometry", () => {
		const COLUMNS = 100
		const scraped = `1${"x".repeat(450)}\n\nshort\n${"y ".repeat(300)}`
		const props: ToolRendererProps = {
			toolData: { tool: "execute_command", command: "curl -s https://example.com", output: scraped },
		}

		it("never renders a row wider than the terminal", () => {
			for (const expanded of [false, true]) {
				const rows = (render(<CommandTool {...props} expanded={expanded} />).lastFrame() ?? "").split("\n")

				for (const row of rows) {
					expect(stringWidth(row)).toBeLessThanOrEqual(COLUMNS)
				}
			}
		})

		it("collapses to the header and the counter, however wide the output", () => {
			const rows = (render(<CommandTool {...props} />).lastFrame() ?? "").split("\n")

			// Not the 13 rows the wrapped text takes, nor one row per line.
			expect(rows).toHaveLength(2)
			expect(rows[1]).toMatch(/^ {4}⎿ {2}… \+4 lines \(ctrl\+o\)$/)
		})

		it("wraps every line in full when expanded", () => {
			const output = render(<CommandTool {...props} expanded />).lastFrame() ?? ""

			expect(output.replace(/[\s⎿]/g, "")).toContain(`1${"x".repeat(450)}`)
			expect(output).not.toContain("…")
		})
	})

	describe("expanded mode", () => {
		const longOutput = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n")

		it("prints no output line by default", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: longOutput,
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).not.toContain("line 1")
			expect(output).toContain("+30 lines (ctrl+o)")
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
			expect(output).not.toContain("+30 lines")
			// The infinite cap must never leak into a marker
			expect(output).not.toContain("Infinity")
		})
	})

	describe("the command header", () => {
		// ink-testing-library renders into an 100-column fake stdout.
		const longCommand =
			'curl -s "https://raw.githubusercontent.com/KellerJordan/modded-nanogpt/master/train_gpt.py" | grep -n "dist\\."'

		it("keeps a long command on one row when collapsed", () => {
			const props: ToolRendererProps = {
				toolData: { tool: "execute_command", command: longCommand, output: "85:dist.init_process_group()" },
			}

			const lines = (render(<CommandTool {...props} />).lastFrame() ?? "").split("\n")
			const header = lines[0] ?? ""

			expect(header).toContain("Bash(curl -s")
			expect(header).toContain("…)")
			expect(header.length).toBeLessThanOrEqual(100)
			// The output belongs to the row below, so the header never spilled.
			expect(header).not.toContain("85:dist")
		})

		it("prints the whole command when expanded", () => {
			const props: ToolRendererProps = {
				toolData: { tool: "execute_command", command: longCommand, output: "85:dist.init_process_group()" },
				expanded: true,
			}

			const output = render(<CommandTool {...props} />).lastFrame() ?? ""

			expect(output.replace(/\s+/g, " ")).toContain('grep -n "dist\\.")')
			expect(output).not.toContain("…)")
		})

		it("flattens a multi-line command when collapsed and keeps its lines when expanded", () => {
			const command = "python3 -c \"\nimport json\nprint(json.load(open('cdk.json')))\n\""

			const collapsed = render(
				<CommandTool toolData={{ tool: "execute_command", command, output: "{}" }} />,
			).lastFrame()
			const expanded = render(
				<CommandTool toolData={{ tool: "execute_command", command, output: "{}" }} expanded />,
			).lastFrame()

			expect(collapsed?.split("\n")[0]).toContain('python3 -c " import json')
			// Expanded keeps the command's own lines, indented under the bullet.
			expect(expanded).toContain("\n  import json")
		})

		it("still renders a bare Bash row when the command is missing", () => {
			const output = render(<CommandTool toolData={{ tool: "execute_command", output: "hello" }} />).lastFrame()

			expect(output).toContain("Bash")
			expect(output).not.toContain("Bash(")
			expect(output).toContain("+1 line (ctrl+o)")
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
