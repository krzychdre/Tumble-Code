import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import ChatHistoryItem from "../ChatHistoryItem.js"
import DynamicTailMessage from "../DynamicTailMessage.js"

describe("DynamicTailMessage", () => {
	it("renders short messages without a clamp indicator", () => {
		const message: TUIMessage = {
			id: "1",
			role: "assistant",
			content: "short answer",
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={10} columns={80} />)
		const output = lastFrame()

		expect(output).toContain("short answer")
		expect(output).not.toContain("+")
	})

	it("clamps long assistant messages and shows the hidden-line count", () => {
		const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
		const message: TUIMessage = {
			id: "2",
			role: "assistant",
			content: lines.join("\n"),
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={5} columns={80} />)
		const output = lastFrame()

		expect(output).toContain("+25 lines")
		expect(output).toContain("line 29")
		expect(output).not.toContain("line 24\n")
	})

	it("tells the user the clamped body prints in full on completion", () => {
		// There is deliberately no expand affordance in the tail (I1), so the
		// marker has to say where the hidden text will show up instead.
		const message: TUIMessage = {
			id: "4",
			role: "assistant",
			content: Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"),
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={5} columns={120} />)

		expect(lastFrame()).toContain("(prints in full when this message completes)")
	})

	it("does not clamp tool messages (renderers cap their own previews)", () => {
		const message: TUIMessage = {
			id: "3",
			role: "tool",
			toolName: "someTool",
			content: Array.from({ length: 30 }, (_, i) => `out ${i}`).join("\n"),
		}

		const { lastFrame } = render(<DynamicTailMessage message={message} maxRows={5} columns={80} />)
		const plain = render(<ChatHistoryItem message={message} />)

		// Identical to the unwrapped render — the tool renderer's own preview
		// cap applies, but DynamicTailMessage adds no clamp of its own.
		expect(lastFrame()).toBe(plain.lastFrame())
	})
	describe("expanded transcript (ctrl+o): live window on a running block", () => {
		const lines = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix} ${i}`)
		const rows = (frame: string | undefined) => (frame ?? "").split("\n").length

		it("keeps a running thinking block on one line in the collapsed transcript", () => {
			const message: TUIMessage = {
				id: "t1",
				role: "thinking",
				content: lines("reason", 30).join("\n"),
				partial: true,
			}

			const frame = render(<DynamicTailMessage message={message} maxRows={8} columns={100} />).lastFrame()

			expect(frame).toContain("Thinking…")
			expect(frame).not.toContain("reason")
		})

		it("shows the newest reasoning lines under a marker, within the row budget", () => {
			const message: TUIMessage = {
				id: "t2",
				role: "thinking",
				content: `${lines("reason", 30).join("\n")}\n`,
				partial: true,
			}

			const frame = render(
				<DynamicTailMessage message={message} maxRows={8} columns={100} expanded />,
			).lastFrame()

			// Header and marker take two of the eight rows, six reasoning lines fit.
			expect(frame).toContain("Thinking")
			expect(frame).toContain("+24 lines (prints in full when this message completes)")
			expect(frame).toContain("reason 24")
			expect(frame).toContain("reason 29")
			expect(frame).not.toContain("reason 23")
			expect(rows(frame)).toBeLessThanOrEqual(8)
		})

		it("shows the newest output lines of a running command", () => {
			const message: TUIMessage = {
				id: "c1",
				role: "tool",
				toolName: "execute_command",
				content: "",
				partial: true,
				toolData: { tool: "execute_command", command: "npm test", output: `${lines("out", 40).join("\n")}\n` },
			}

			const frame = render(
				<DynamicTailMessage message={message} maxRows={8} columns={100} expanded />,
			).lastFrame()

			expect(frame).toContain("Bash(npm test)")
			expect(frame).toContain("+34 lines")
			expect(frame).toContain("out 34")
			expect(frame).toContain("out 39")
			expect(frame).not.toContain("out 33")
			expect(rows(frame)).toBeLessThanOrEqual(8)
		})

		it("shows the newest lines of an MCP response", () => {
			const message: TUIMessage = {
				id: "m1",
				role: "tool",
				toolName: "use_mcp_server",
				content: "",
				toolData: { tool: "use_mcp_server", path: "docs › search", content: lines("hit", 20).join("\n") },
			}

			const frame = render(
				<DynamicTailMessage message={message} maxRows={8} columns={100} expanded />,
			).lastFrame()

			expect(frame).toContain("+14 lines")
			expect(frame).toContain("hit 19")
			expect(frame).not.toContain("hit 13")
			expect(rows(frame)).toBeLessThanOrEqual(8)
		})

		it("shows a short live body in full, without a marker", () => {
			const message: TUIMessage = {
				id: "t3",
				role: "thinking",
				content: lines("reason", 3).join("\n"),
				partial: true,
			}

			const frame = render(
				<DynamicTailMessage message={message} maxRows={10} columns={100} expanded />,
			).lastFrame()

			expect(frame).toContain("reason 0")
			expect(frame).toContain("reason 2")
			expect(frame).not.toContain("+")
		})

		it("keeps one endless reasoning paragraph within the row budget", () => {
			// Reasoning often comes as long paragraphs without a newline, which
			// would wrap into a hundred rows if the window only cut whole lines.
			const message: TUIMessage = {
				id: "t4",
				role: "thinking",
				content: "word ".repeat(2000),
				partial: true,
			}

			const frame = render(
				<DynamicTailMessage message={message} maxRows={8} columns={100} expanded />,
			).lastFrame()

			// The character cut is an estimate and ink wraps at word
			// boundaries, so a row of slack is allowed.
			expect(rows(frame)).toBeLessThanOrEqual(9)
		})

		it("leaves tool rows without a growing body as they are in the collapsed tail", () => {
			const message: TUIMessage = {
				id: "r1",
				role: "tool",
				toolName: "read_file",
				content: "",
				toolData: { tool: "read_file", path: "src/a.ts", content: lines("code", 40).join("\n") },
			}

			const expanded = render(
				<DynamicTailMessage message={message} maxRows={8} columns={100} expanded />,
			).lastFrame()
			const collapsed = render(<DynamicTailMessage message={message} maxRows={8} columns={100} />).lastFrame()

			expect(expanded).toBe(collapsed)
		})
	})
})
