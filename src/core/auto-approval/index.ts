import {
	type ClineAsk,
	type ClineSayTool,
	type McpServerUse,
	type FollowUpData,
	type ExtensionState,
	firstUsableSuggestion,
	isNonBlockingAsk,
	SETTINGS_DEFAULTS,
} from "@roo-code/types"

import { ClineAskResponse } from "../../shared/WebviewMessage"

import { getToolActionApprovalCategory } from "./tools"
import { isMcpToolAlwaysAllowed } from "./mcp"
import { getCommandDecision } from "./commands"
import { getModeBySlug } from "../../shared/modes"

// We have auto-approval actions for different categories.
export type AutoApprovalState =
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysApprovePlan"
	| "alwaysAllowExecute"
	| "alwaysAllowFollowupQuestions"

// Additional state keys needed for plan-approval gate lookups.
export type AutoApprovalPlanState = "mode" | "customModes"

// Some of these actions have additional settings associated with them.
export type AutoApprovalStateOptions =
	| "autoApprovalEnabled"
	| "autoApprovalMode" // "default" | "bypass" | "autonomous"
	| "alwaysAllowReadOnlyOutsideWorkspace" // For `alwaysAllowReadOnly`.
	| "alwaysAllowWriteOutsideWorkspace" // For `alwaysAllowWrite`.
	| "alwaysAllowWriteProtected"
	| "followupAutoApproveTimeoutMs" // For `alwaysAllowFollowupQuestions`.
	| "mcpServers" // For `alwaysAllowMcp`.
	| "allowedCommands" // For `alwaysAllowExecute`.
	| "deniedCommands"
	| "cwd" // Resolved in TaskAskSay for the asking task's own cwd.

export type CheckAutoApprovalResult =
	| { decision: "approve" }
	| { decision: "deny" }
	| { decision: "ask" }
	| {
			decision: "timeout"
			timeout: number
			fn: () => { askResponse: ClineAskResponse; text?: string; images?: string[] }
	  }

export async function checkAutoApproval({
	state,
	ask,
	text,
	isProtected,
}: {
	state?: Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions | AutoApprovalPlanState>
	ask: ClineAsk
	text?: string
	isProtected?: boolean
}): Promise<CheckAutoApprovalResult> {
	if (isNonBlockingAsk(ask)) {
		return { decision: "approve" }
	}

	if (!state || !state.autoApprovalEnabled) {
		return { decision: "ask" }
	}

	// Bypass / Autonomous tiers override the granular toggles, allowlists, and
	// outside-workspace / protected-file guards. They only force-approve the
	// interactive permission asks — every other ask (api_req_failed, resume_*,
	// mistake_limit_reached, auto_approval_max_req_reached, ...) intentionally
	// falls through to the default handling below so it still prompts the user.
	const mode = state.autoApprovalMode ?? SETTINGS_DEFAULTS.autoApprovalMode

	if (mode === "bypass" || mode === "autonomous") {
		if (ask === "command" || ask === "tool" || ask === "use_mcp_server") {
			// The plan-approval gate survives bypass (semi-auto): only
			// autonomous mode or the Plan auto-approve toggle may skip plan
			// review. This covers both the mode-exit gate (switchMode/newTask)
			// and the post-save plan review pause (reviewPlan).
			if (mode === "bypass" && ask === "tool" && state.alwaysApprovePlan !== true) {
				let tool: ClineSayTool | undefined

				try {
					tool = JSON.parse(text || "{}")
				} catch {
					tool = undefined
				}

				const category = getToolActionApprovalCategory(tool)

				if ((category === "modeSwitch" || category === "subtask") && isPlanApprovalRequired(state)) {
					return { decision: "ask" }
				}

				if (category === "planReview") {
					return { decision: "ask" }
				}
			}

			return { decision: "approve" }
		}

		if (ask === "followup") {
			// Bypass keeps questions interactive (semi-auto); autonomous answers them.
			if (mode === "autonomous") {
				let answer: string | undefined

				try {
					// Skip blank, missing or non-string answers (weak models emit them).
					answer = firstUsableSuggestion((JSON.parse(text || "{}") as FollowUpData).suggest)?.answer
				} catch {
					answer = undefined
				}

				const timeout =
					typeof state.followupAutoApproveTimeoutMs === "number" && state.followupAutoApproveTimeoutMs > 0
						? state.followupAutoApproveTimeoutMs
						: 0

				// Always proceed: use the first usable suggestion when present, otherwise
				// respond with empty text so the task continues unattended.
				return {
					decision: "timeout",
					timeout,
					fn: () => ({ askResponse: "messageResponse", text: answer ?? "" }),
				}
			}

			return { decision: "ask" }
		}
	}

	if (ask === "followup") {
		if (state.alwaysAllowFollowupQuestions === true) {
			try {
				// Pick the first suggestion with a usable answer: a blank or missing one would
				// answer the question with no content once the timeout fires.
				const suggestion = firstUsableSuggestion((JSON.parse(text || "{}") as FollowUpData).suggest)

				if (
					suggestion &&
					typeof state.followupAutoApproveTimeoutMs === "number" &&
					state.followupAutoApproveTimeoutMs > 0
				) {
					return {
						decision: "timeout",
						timeout: state.followupAutoApproveTimeoutMs,
						fn: () => ({ askResponse: "messageResponse", text: suggestion.answer }),
					}
				} else {
					return { decision: "ask" }
				}
			} catch (error) {
				return { decision: "ask" }
			}
		} else {
			return { decision: "ask" }
		}
	}

	if (ask === "use_mcp_server") {
		if (!text) {
			return { decision: "ask" }
		}

		try {
			const mcpServerUse = JSON.parse(text) as McpServerUse

			if (mcpServerUse.type === "use_mcp_tool") {
				return state.alwaysAllowMcp === true && isMcpToolAlwaysAllowed(mcpServerUse, state.mcpServers)
					? { decision: "approve" }
					: { decision: "ask" }
			} else if (mcpServerUse.type === "access_mcp_resource") {
				return state.alwaysAllowMcp === true ? { decision: "approve" } : { decision: "ask" }
			}
		} catch (error) {
			return { decision: "ask" }
		}

		return { decision: "ask" }
	}

	if (ask === "command") {
		if (!text) {
			return { decision: "ask" }
		}

		if (state.alwaysAllowExecute === true) {
			const decision = getCommandDecision(text, state.allowedCommands || [], state.deniedCommands || [])

			if (decision === "auto_approve") {
				return { decision: "approve" }
			} else if (decision === "auto_deny") {
				return { decision: "deny" }
			} else {
				return { decision: "ask" }
			}
		}
	}

	if (ask === "tool") {
		let tool: ClineSayTool | undefined

		try {
			tool = JSON.parse(text || "{}")
		} catch (error) {
			console.error("Failed to parse tool:", error)
		}

		if (!tool) {
			return { decision: "ask" }
		}

		// The category comes from the tool descriptors (src/core/tools/toolDescriptors.ts);
		// an action without one (a tool no toggle covers, an unknown name) asks.
		switch (getToolActionApprovalCategory(tool)) {
			// updateTodoList, and skill: it only loads instructions from skills the user
			// installed, never arbitrary files, so loading one does not interrupt the task.
			case "alwaysAllowed":
				return { decision: "approve" }

			case "modeSwitch":
				// Plan-approval gate: when the current mode requires plan review and
				// the user hasn't enabled the Plan auto-approve toggle, force an ask
				// even if alwaysAllowModeSwitch is on.
				if (isPlanApprovalRequired(state) && state.alwaysApprovePlan !== true) {
					return { decision: "ask" }
				}
				return state.alwaysAllowModeSwitch === true ? { decision: "approve" } : { decision: "ask" }

			case "subtask":
				// Plan-approval gate: same as a mode switch, a subtask is an
				// implementation escape hatch from a planning mode.
				if (isPlanApprovalRequired(state) && state.alwaysApprovePlan !== true) {
					return { decision: "ask" }
				}
				return state.alwaysAllowSubtasks === true ? { decision: "approve" } : { decision: "ask" }

			// finishTask is NOT gated: it returns control to the parent task rather
			// than starting new work, so plan review is not relevant.
			case "subtaskFinish":
				return state.alwaysAllowSubtasks === true ? { decision: "approve" } : { decision: "ask" }

			// Post-save plan review pause: the write tool already saved the plan
			// file and is now asking for review approval. Approve only when the
			// Plan auto-approve toggle is on; otherwise ask the user.
			case "planReview":
				return state.alwaysApprovePlan === true ? { decision: "approve" } : { decision: "ask" }

			case "readOnly":
				return state.alwaysAllowReadOnly === true &&
					(!tool.isOutsideWorkspace || state.alwaysAllowReadOnlyOutsideWorkspace === true)
					? { decision: "approve" }
					: { decision: "ask" }

			case "write":
				return state.alwaysAllowWrite === true &&
					(!tool.isOutsideWorkspace || state.alwaysAllowWriteOutsideWorkspace === true) &&
					(!isProtected || state.alwaysAllowWriteProtected === true)
					? { decision: "approve" }
					: { decision: "ask" }
		}
	}

	return { decision: "ask" }
}

/**
 * Resolve the current mode and check whether it requires plan approval.
 * Returns false when the mode can't be resolved (unknown mode slug) so the
 * gate fails open rather than blocking an unrecognized mode.
 */
function isPlanApprovalRequired(state: Pick<ExtensionState, AutoApprovalPlanState>): boolean {
	const modeConfig = getModeBySlug(state.mode ?? "", state.customModes)
	return modeConfig?.planApprovalRequired === true
}

export { AutoApprovalHandler } from "./AutoApprovalHandler"
