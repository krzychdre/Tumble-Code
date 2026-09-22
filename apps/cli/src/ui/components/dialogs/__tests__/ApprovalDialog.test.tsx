import { render } from "ink-testing-library"

import ApprovalDialog from "../ApprovalDialog.js"
import type { PendingAsk } from "../../../types.js"

/** Yield to React so a written keypress is processed and the frame flushes. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

describe("ApprovalDialog", () => {
	describe("command ask", () => {
		const ask: PendingAsk = {
			id: "ask-1",
			type: "command",
			content: "ls -la",
		}

		it("renders the Bash command title, body, and question", () => {
			const { lastFrame } = render(<ApprovalDialog ask={ask} onApprove={() => {}} onReject={() => {}} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("Bash command")
			expect(frame).toContain("$ ls -la")
			expect(frame).toContain("Do you want to proceed?")
			expect(frame).toContain("Yes")
			expect(frame).toContain("No")
		})

		it("calls onApprove on 'y' keypress", async () => {
			let approved = false
			let rejected = false
			const { stdin } = render(
				<ApprovalDialog ask={ask} onApprove={() => (approved = true)} onReject={() => (rejected = true)} />,
			)
			stdin.write("y")
			await flush()
			expect(approved).toBe(true)
			expect(rejected).toBe(false)
		})

		it("calls onReject on 'n' keypress", async () => {
			let approved = false
			let rejected = false
			const { stdin } = render(
				<ApprovalDialog ask={ask} onApprove={() => (approved = true)} onReject={() => (rejected = true)} />,
			)
			stdin.write("n")
			await flush()
			expect(approved).toBe(false)
			expect(rejected).toBe(true)
		})
	})

	describe("tool ask", () => {
		const ask: PendingAsk = {
			id: "ask-2",
			type: "tool",
			content: JSON.stringify({ tool: "execute_command", command: "ls" }),
		}

		it("renders the humanized tool name as title and the command body", () => {
			const { lastFrame } = render(<ApprovalDialog ask={ask} onApprove={() => {}} onReject={() => {}} />)
			const frame = lastFrame() ?? ""
			// getToolDisplayName("execute_command") → "Execute Command"
			expect(frame).toContain("Execute Command")
			expect(frame).toContain("$ ls")
			expect(frame).toContain("Do you want to proceed?")
		})

		it("renders path (bold) for file-write tool asks", () => {
			const fileAsk: PendingAsk = {
				id: "ask-3",
				type: "tool",
				content: JSON.stringify({ tool: "write_to_file", path: "src/foo.ts" }),
			}
			const { lastFrame } = render(<ApprovalDialog ask={fileAsk} onApprove={() => {}} onReject={() => {}} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("Write File")
			expect(frame).toContain("src/foo.ts")
		})

		it("renders diff stats when present", () => {
			const diffAsk: PendingAsk = {
				id: "ask-4",
				type: "tool",
				content: JSON.stringify({
					tool: "apply_diff",
					path: "src/foo.ts",
					diffStats: { added: 12, removed: 3 },
				}),
			}
			const { lastFrame } = render(<ApprovalDialog ask={diffAsk} onApprove={() => {}} onReject={() => {}} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("+12 -3")
		})
	})

	describe("SelectList interaction", () => {
		const ask: PendingAsk = {
			id: "ask-5",
			type: "command",
			content: "echo hi",
		}

		it("calls onApprove on Enter (Yes is first and focused)", async () => {
			let approved = false
			let rejected = false
			const { stdin } = render(
				<ApprovalDialog ask={ask} onApprove={() => (approved = true)} onReject={() => (rejected = true)} />,
			)
			stdin.write("\r") // enter on focused "Yes"
			await flush()
			expect(approved).toBe(true)
			expect(rejected).toBe(false)
		})

		it("calls onReject on down-arrow + Enter (focus moves to No)", async () => {
			let approved = false
			let rejected = false
			const { stdin } = render(
				<ApprovalDialog ask={ask} onApprove={() => (approved = true)} onReject={() => (rejected = true)} />,
			)
			stdin.write("[B") // down arrow → No
			await flush()
			stdin.write("\r") // enter on "No"
			await flush()
			expect(approved).toBe(false)
			expect(rejected).toBe(true)
		})
	})

	describe("non-JSON content fallback", () => {
		it("renders Tool use title and no body when content is not JSON", () => {
			const ask: PendingAsk = {
				id: "ask-6",
				type: "tool",
				content: "some plain text",
			}
			const { lastFrame } = render(<ApprovalDialog ask={ask} onApprove={() => {}} onReject={() => {}} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("Tool use")
			expect(frame).toContain("Do you want to proceed?")
		})
	})
})
