import type { ExtensionState, ModeConfig } from "@roo-code/types"

import {
	checkAutoApproval,
	type AutoApprovalState,
	type AutoApprovalStateOptions,
	type AutoApprovalPlanState,
} from "../index"
import { registerPlanReviewFile, unregisterPlanReviewFile } from "../../webview/planReviewRegistry"

type State = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions | AutoApprovalPlanState>

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
		alwaysApprovePlan: false,
		alwaysAllowExecute: false,
		alwaysAllowFollowupQuestions: false,
		followupAutoApproveTimeoutMs: 0,
		allowedCommands: [],
		deniedCommands: [],
		mode: "code",
		customModes: [],
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

	describe("plan-approval gate", () => {
		const switchModeText = JSON.stringify({ tool: "switchMode", mode: "code" })
		const newTaskText = JSON.stringify({ tool: "newTask", mode: "code" })
		const finishTaskText = JSON.stringify({ tool: "finishTask" })

		it("architect + switchMode + alwaysAllowModeSwitch ON + alwaysApprovePlan OFF → ask", async () => {
			const state = baseState({ mode: "architect", alwaysAllowModeSwitch: true, alwaysApprovePlan: false })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("ask")
		})

		it("architect + switchMode + alwaysAllowModeSwitch ON + alwaysApprovePlan ON → approve", async () => {
			const state = baseState({ mode: "architect", alwaysAllowModeSwitch: true, alwaysApprovePlan: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("approve")
		})

		it("architect + newTask + alwaysAllowSubtasks ON → ask (subtask is implementation escape hatch)", async () => {
			const state = baseState({ mode: "architect", alwaysAllowSubtasks: true, alwaysApprovePlan: false })
			const result = await checkAutoApproval({ state, ask: "tool", text: newTaskText })
			expect(result.decision).toBe("ask")
		})

		it("architect + finishTask + alwaysAllowSubtasks ON → approve (finishTask not gated)", async () => {
			const state = baseState({ mode: "architect", alwaysAllowSubtasks: true, alwaysApprovePlan: false })
			const result = await checkAutoApproval({ state, ask: "tool", text: finishTaskText })
			expect(result.decision).toBe("approve")
		})

		it("code mode + switchMode + alwaysAllowModeSwitch ON → approve (non-planning mode unaffected)", async () => {
			const state = baseState({ mode: "code", alwaysAllowModeSwitch: true, alwaysApprovePlan: false })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("approve")
		})

		it("custom mode with planApprovalRequired + switchMode → ask", async () => {
			const customModes: ModeConfig[] = [
				{
					slug: "my-planner",
					name: "My Planner",
					roleDefinition: "You plan things.",
					groups: ["read"],
					planApprovalRequired: true,
				},
			]
			const state = baseState({ mode: "my-planner", customModes, alwaysAllowModeSwitch: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("ask")
		})

		it("bypass mode + architect + switchMode → ask (gate survives bypass)", async () => {
			const state = baseState({ mode: "architect", autoApprovalMode: "bypass", alwaysAllowModeSwitch: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("ask")
		})

		it("bypass mode + architect + newTask → ask (gate survives bypass)", async () => {
			const state = baseState({ mode: "architect", autoApprovalMode: "bypass", alwaysAllowSubtasks: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: newTaskText })
			expect(result.decision).toBe("ask")
		})

		it("bypass mode + architect + switchMode + alwaysApprovePlan ON → approve", async () => {
			const state = baseState({ mode: "architect", autoApprovalMode: "bypass", alwaysApprovePlan: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("approve")
		})

		it("bypass mode + non-planning mode + switchMode → approve (gate not applicable)", async () => {
			const state = baseState({ mode: "code", autoApprovalMode: "bypass" })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("approve")
		})

		it("bypass mode + architect + non-gated tool ask → approve (gate only guards switchMode/newTask)", async () => {
			const state = baseState({ mode: "architect", autoApprovalMode: "bypass" })
			const result = await checkAutoApproval({
				state,
				ask: "tool",
				text: JSON.stringify({ tool: "finishTask" }),
			})
			expect(result.decision).toBe("approve")
		})

		it("autonomous mode + architect + switchMode → approve (autonomous bypasses the gate)", async () => {
			const state = baseState({ mode: "architect", autoApprovalMode: "autonomous", alwaysApprovePlan: false })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("approve")
		})

		it("architect + switchMode + alwaysAllowModeSwitch OFF + alwaysApprovePlan ON → ask (plan toggle doesn't grant approval by itself)", async () => {
			const state = baseState({ mode: "architect", alwaysAllowModeSwitch: false, alwaysApprovePlan: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: switchModeText })
			expect(result.decision).toBe("ask")
		})

		it("architect + newTask + alwaysAllowSubtasks ON + alwaysApprovePlan ON → approve", async () => {
			const state = baseState({ mode: "architect", alwaysAllowSubtasks: true, alwaysApprovePlan: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: newTaskText })
			expect(result.decision).toBe("approve")
		})
	})

	describe("reviewed-plan-file write gate", () => {
		const cwd = "/project"
		const reviewedFile = "/project/plans/plan.md"
		const planWriteText = JSON.stringify({ tool: "editedExistingFile", path: "plans/plan.md" })
		const otherWriteText = JSON.stringify({ tool: "editedExistingFile", path: "src/other.ts" })

		beforeEach(() => {
			registerPlanReviewFile(reviewedFile)
		})

		afterEach(() => {
			unregisterPlanReviewFile(reviewedFile)
		})

		it("write to a file open in a Plan Review panel → ask even with alwaysAllowWrite ON", async () => {
			const state = baseState({ cwd, alwaysAllowWrite: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("ask")
		})

		it("write to a different file → approve (gate scoped to the reviewed file)", async () => {
			const state = baseState({ cwd, alwaysAllowWrite: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: otherWriteText })
			expect(result.decision).toBe("approve")
		})

		it("write to reviewed file with no panel open → approve", async () => {
			unregisterPlanReviewFile(reviewedFile)
			const state = baseState({ cwd, alwaysAllowWrite: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("approve")
		})

		it("write to reviewed file + alwaysApprovePlan ON → approve", async () => {
			const state = baseState({ cwd, alwaysAllowWrite: true, alwaysApprovePlan: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("approve")
		})

		it("absolute tool path is matched without cwd", async () => {
			const state = baseState({ alwaysAllowWrite: true })
			const result = await checkAutoApproval({
				state,
				ask: "tool",
				text: JSON.stringify({ tool: "editedExistingFile", path: reviewedFile }),
			})
			expect(result.decision).toBe("ask")
		})

		it("bypass mode + write to reviewed file → ask (gate survives bypass)", async () => {
			const state = baseState({ cwd, autoApprovalMode: "bypass" })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("ask")
		})

		it("autonomous mode + write to reviewed file → approve (autonomous bypasses the gate)", async () => {
			const state = baseState({ cwd, autoApprovalMode: "autonomous" })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("approve")
		})

		it("architect mode is gated too while the panel is open", async () => {
			const state = baseState({ cwd, mode: "architect", alwaysAllowWrite: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("ask")
		})

		it("fails closed: relative write with no cwd while a panel is open → ask", async () => {
			const state = baseState({ cwd: undefined, alwaysAllowWrite: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("ask")
		})

		it("relative write with no cwd and no panel open → approve", async () => {
			unregisterPlanReviewFile(reviewedFile)
			const state = baseState({ cwd: undefined, alwaysAllowWrite: true })
			const result = await checkAutoApproval({ state, ask: "tool", text: planWriteText })
			expect(result.decision).toBe("approve")
		})
	})
})
