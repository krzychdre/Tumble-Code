import type { ExtensionState } from "@roo-code/types"

import { checkAutoApproval, type AutoApprovalState, type AutoApprovalStateOptions } from "../index"

type State = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions>

const baseState = (overrides: Partial<State> = {}): State =>
	({
		autoApprovalEnabled: true,
		autoApprovalMode: "default",
		alwaysAllowReadOnly: false,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		alwaysAllowWrite: false,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowExecute: false,
		alwaysAllowFollowupQuestions: false,
		followupAutoApproveTimeoutMs: 0,
		allowedCommands: [],
		deniedCommands: [],
		...overrides,
	}) as State

const writeToolText = JSON.stringify({
	tool: "editedExistingFile",
	isOutsideWorkspace: true,
})

const mcpText = JSON.stringify({ type: "use_mcp_tool", serverName: "s", toolName: "t" })

const followupText = (withSuggestion: boolean) =>
	JSON.stringify({
		question: "Pick one",
		suggest: withSuggestion ? [{ answer: "first answer" }] : [],
	})

describe("checkAutoApproval modes", () => {
	describe("bypass mode", () => {
		const state = baseState({ autoApprovalMode: "bypass" })

		it("approves unknown commands not on the allowlist", async () => {
			const result = await checkAutoApproval({ state, ask: "command", text: "rm -rf /tmp/whatever" })
			expect(result.decision).toBe("approve")
		})

		it("approves writes outside the workspace, ignoring guards", async () => {
			const result = await checkAutoApproval({ state, ask: "tool", text: writeToolText, isProtected: true })
			expect(result.decision).toBe("approve")
		})

		it("approves MCP usage without per-tool allow", async () => {
			const result = await checkAutoApproval({ state, ask: "use_mcp_server", text: mcpText })
			expect(result.decision).toBe("approve")
		})

		it("still interrupts on follow-up questions", async () => {
			const result = await checkAutoApproval({ state, ask: "followup", text: followupText(true) })
			expect(result.decision).toBe("ask")
		})

		it("does not blanket-approve non-permission asks (api_req_failed)", async () => {
			const result = await checkAutoApproval({ state, ask: "api_req_failed" })
			expect(result.decision).toBe("ask")
		})

		it("does not blanket-approve resume_task", async () => {
			const result = await checkAutoApproval({ state, ask: "resume_task" })
			expect(result.decision).toBe("ask")
		})
	})

	describe("autonomous mode", () => {
		const state = baseState({ autoApprovalMode: "autonomous" })

		it("approves commands like bypass", async () => {
			const result = await checkAutoApproval({ state, ask: "command", text: "some-unknown-cmd" })
			expect(result.decision).toBe("approve")
		})

		it("auto-answers follow-ups with the first suggestion", async () => {
			const result = await checkAutoApproval({ state, ask: "followup", text: followupText(true) })
			expect(result.decision).toBe("timeout")
			if (result.decision === "timeout") {
				expect(result.fn()).toEqual({ askResponse: "messageResponse", text: "first answer" })
			}
		})

		it("proceeds with empty text when a follow-up has no suggestions", async () => {
			const result = await checkAutoApproval({ state, ask: "followup", text: followupText(false) })
			expect(result.decision).toBe("timeout")
			if (result.decision === "timeout") {
				expect(result.fn()).toEqual({ askResponse: "messageResponse", text: "" })
			}
		})

		it("honors the configured follow-up timeout", async () => {
			const result = await checkAutoApproval({
				state: baseState({ autoApprovalMode: "autonomous", followupAutoApproveTimeoutMs: 5000 }),
				ask: "followup",
				text: followupText(true),
			})
			expect(result.decision).toBe("timeout")
			if (result.decision === "timeout") {
				expect(result.timeout).toBe(5000)
			}
		})
	})

	describe("kill switch and default mode", () => {
		it("prompts for everything when autoApprovalEnabled is off, even in bypass", async () => {
			const state = baseState({ autoApprovalMode: "bypass", autoApprovalEnabled: false })
			const result = await checkAutoApproval({ state, ask: "command", text: "ls" })
			expect(result.decision).toBe("ask")
		})

		it("default mode still respects the command allowlist", async () => {
			const state = baseState({ autoApprovalMode: "default", alwaysAllowExecute: true })
			const result = await checkAutoApproval({ state, ask: "command", text: "definitely-not-allowed" })
			expect(result.decision).toBe("ask")
		})
	})
})
