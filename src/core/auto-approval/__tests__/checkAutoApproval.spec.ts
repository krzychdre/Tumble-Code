// The readable cases of the auto-approval policy, each one a decision someone asked for.
// approvalMatrix.spec.ts pins every settings combination; this table names the ones that matter.

import type { ClineAsk, ExtensionState, ModeConfig } from "@tumble-code/types"

import {
	checkAutoApproval,
	type AutoApprovalState,
	type AutoApprovalStateOptions,
	type AutoApprovalPlanState,
} from "../index"

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

const tool = (action: string, extra: Record<string, unknown> = {}) => JSON.stringify({ tool: action, ...extra })
const followup = (suggest: unknown[]) => JSON.stringify({ question: "Pick one", suggest })

const bypass = { autoApprovalMode: "bypass" } as const
const autonomous = { autoApprovalMode: "autonomous" } as const
const architect = { mode: "architect" }
const planner: ModeConfig = {
	slug: "my-planner",
	name: "My Planner",
	roleDefinition: "You plan things.",
	groups: ["read"],
	planApprovalRequired: true,
}

describe("checkAutoApproval", () => {
	it.each<[string, Partial<State>, ClineAsk, string | undefined, boolean, "approve" | "ask"]>([
		// bypass approves every permission ask, guards included, but no other kind of ask
		["bypass: an unknown command", bypass, "command", "rm -rf /tmp/whatever", false, "approve"],
		[
			"bypass: a protected write outside the workspace",
			bypass,
			"tool",
			tool("editedExistingFile", { isOutsideWorkspace: true }),
			true,
			"approve",
		],
		[
			"bypass: MCP without per-tool allow",
			bypass,
			"use_mcp_server",
			JSON.stringify({ type: "use_mcp_tool", serverName: "s", toolName: "t" }),
			false,
			"approve",
		],
		["bypass: a follow-up question", bypass, "followup", followup([{ answer: "first" }]), false, "ask"],
		["bypass: a failed request", bypass, "api_req_failed", undefined, false, "ask"],
		["bypass: resuming a task", bypass, "resume_task", undefined, false, "ask"],
		["autonomous: an unknown command", autonomous, "command", "some-unknown-cmd", false, "approve"],
		["the kill switch, even in bypass", { ...bypass, autoApprovalEnabled: false }, "command", "ls", false, "ask"],
		[
			"default: a command outside the allowlist",
			{ alwaysAllowExecute: true },
			"command",
			"definitely-not-allowed",
			false,
			"ask",
		],
		// The plan gate: a planning mode must not leave planning without the user, unless the
		// user turned plan review off; it survives bypass, autonomous skips it.
		[
			"architect: switching mode",
			{ ...architect, alwaysAllowModeSwitch: true },
			"tool",
			tool("switchMode"),
			false,
			"ask",
		],
		[
			"architect: switching mode, plans pre-approved",
			{ ...architect, alwaysAllowModeSwitch: true, alwaysApprovePlan: true },
			"tool",
			tool("switchMode"),
			false,
			"approve",
		],
		[
			"architect: plans pre-approved without the mode switch toggle",
			{ ...architect, alwaysApprovePlan: true },
			"tool",
			tool("switchMode"),
			false,
			"ask",
		],
		["architect: a subtask", { ...architect, alwaysAllowSubtasks: true }, "tool", tool("newTask"), false, "ask"],
		[
			"architect: a subtask, plans pre-approved",
			{ ...architect, alwaysAllowSubtasks: true, alwaysApprovePlan: true },
			"tool",
			tool("newTask"),
			false,
			"approve",
		],
		[
			"architect: finishing a subtask",
			{ ...architect, alwaysAllowSubtasks: true },
			"tool",
			tool("finishTask"),
			false,
			"approve",
		],
		["code: switching mode", { alwaysAllowModeSwitch: true }, "tool", tool("switchMode"), false, "approve"],
		[
			"a custom planning mode: switching mode",
			{ mode: "my-planner", customModes: [planner], alwaysAllowModeSwitch: true },
			"tool",
			tool("switchMode"),
			false,
			"ask",
		],
		["bypass + architect: switching mode", { ...bypass, ...architect }, "tool", tool("switchMode"), false, "ask"],
		["bypass + architect: a subtask", { ...bypass, ...architect }, "tool", tool("newTask"), false, "ask"],
		[
			"bypass + architect: switching mode, plans pre-approved",
			{ ...bypass, ...architect, alwaysApprovePlan: true },
			"tool",
			tool("switchMode"),
			false,
			"approve",
		],
		["bypass + architect: another tool", { ...bypass, ...architect }, "tool", tool("finishTask"), false, "approve"],
		[
			"autonomous + architect: switching mode",
			{ ...autonomous, ...architect },
			"tool",
			tool("switchMode"),
			false,
			"approve",
		],
		["the plan review pause", {}, "tool", tool("reviewPlan", { path: "plans/plan.md" }), false, "ask"],
		[
			"the plan review pause, plans pre-approved",
			{ alwaysApprovePlan: true },
			"tool",
			tool("reviewPlan"),
			false,
			"approve",
		],
		["bypass: the plan review pause", bypass, "tool", tool("reviewPlan"), false, "ask"],
		["autonomous: the plan review pause", autonomous, "tool", tool("reviewPlan"), false, "approve"],
	])("%s: %s", async (_, state, ask, text, isProtected, decision) => {
		expect((await checkAutoApproval({ state: baseState(state), ask, text, isProtected })).decision).toBe(decision)
	})

	// Weak models (GLM, Qwen, local Llamas) send follow-up suggestions with a blank, missing or
	// non-string answer. Auto-approval must never answer the question with that.
	const autoAnswer = { alwaysAllowFollowupQuestions: true, followupAutoApproveTimeoutMs: 1000 }
	it.each<[string, Partial<State>, unknown[], number, string]>([
		["autonomous: the first suggestion", autonomous, [{ answer: "first answer" }], 0, "first answer"],
		[
			"autonomous: the configured wait",
			{ ...autonomous, followupAutoApproveTimeoutMs: 5000 },
			[{ answer: "a" }],
			5000,
			"a",
		],
		["autonomous: empty text without suggestions", autonomous, [], 0, ""],
		[
			"autonomous: the first usable answer",
			autonomous,
			[{ answer: "" }, { answer: 7 }, { answer: "second" }],
			0,
			"second",
		],
		["autonomous: empty text, never a non-string", autonomous, [{ answer: 7 }], 0, ""],
		[
			"default: the first usable answer",
			autoAnswer,
			[{ answer: "   " }, { mode: "code" }, { answer: 42 }, { answer: "real answer" }],
			1000,
			"real answer",
		],
	])("answers a follow-up with %s", async (_, state, suggest, timeout, text) => {
		const result = await checkAutoApproval({ state: baseState(state), ask: "followup", text: followup(suggest) })

		expect(result).toMatchObject({ decision: "timeout", timeout })
		expect(result.decision === "timeout" && result.fn()).toEqual({ askResponse: "messageResponse", text })
	})

	it("leaves a follow-up without a usable answer to the user", async () => {
		const text = followup([{ answer: "" }, { mode: "code" }, null])

		expect((await checkAutoApproval({ state: baseState(autoAnswer), ask: "followup", text })).decision).toBe("ask")
	})
})
