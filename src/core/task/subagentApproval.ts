/**
 * The auto-approval policy for headless parallel-subagent children.
 *
 * Each subagent runs in its own git worktree as a background task. A subagent
 * does real work: it may run shell commands, call MCP servers, and edit files
 * inside its worktree. The user's configured auto-approval policy — write
 * toggles, command allow/deny lists, MCP toggles, protected-file guards —
 * must be honoured EXACTLY as it would be for a foreground task: worktree
 * isolation is not consent. When the user's settings would ask, the ask
 * surfaces interactively in the subagents panel (Approve/Deny), bounded by
 * the TaskAskSay background fallback so unattended runs never hang.
 *
 * Policy:
 * - `followup` asks → `undefined` (interactive: surfaced in the subagents
 *   panel, answerable by the user, auto-APPROVED after the fallback window);
 * - other non-`tool`/`command`/`use_mcp_server` asks (completion_result,
 *   api_req_failed, resume, …) → `"approve"` (autonomy; retries stay bounded
 *   by `maxAgentTurns`);
 * - read-only tool actions → `"approve"` (reads/searches are safe anywhere);
 * - everything else (file writes — INCLUDING inside the worktree — commands,
 *   MCP) → consult `checkAutoApproval` with the user's live settings:
 *   `"approve"`/`"deny"` pass through; `"ask"`/`"timeout"` return `undefined`
 *   so the normal blocking ask flow runs — panel shows Approve/Deny, and the
 *   TaskAskSay fallback DENIES a permission ask that nobody answers (an
 *   unattended subagent must never write without permission).
 */

import type { ClineAsk, ClineSayTool, ExtensionState } from "@roo-code/types"

import { checkAutoApproval, type AutoApprovalState, type AutoApprovalStateOptions } from "../auto-approval"
import { isReadOnlyToolAction } from "../auto-approval/tools"
import type { AutoApprovalOverride } from "./Task"

/** State slice consumed by `checkAutoApproval`. */
export type ApprovalState = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions>

/** Options for building a subagent approval policy. */
export interface SubagentApprovalOptions {
	/** Accessor for the live extension state (delegated asks consult it). */
	getState: () => Promise<ApprovalState>
	/**
	 * Absolute path of the child's worktree. Kept for interface stability
	 * (callers identify the child's sandbox); containment no longer grants
	 * write approval — the user's settings decide.
	 */
	worktreePath: string
}

/**
 * Build the auto-approval policy for a headless parallel-subagent child.
 * Decides `"approve"`/`"deny"` where the user's settings are unambiguous and
 * returns `undefined` where a real approval decision is needed — the ask then
 * blocks and surfaces in the subagents panel (bounded by the TaskAskSay
 * background fallback, so the child can never block forever).
 */
export function buildSubagentApprovalPolicy(options: SubagentApprovalOptions): AutoApprovalOverride {
	const { getState } = options

	return async (ask: ClineAsk, text?: string, isProtected?: boolean) => {
		// Followup questions fall through to the normal ask flow: the child
		// blocks, its panel row flips to "awaiting input", the user can
		// answer; the fallback auto-approves (empty answer) after the window.
		if (ask === "followup") {
			return undefined
		}

		// Non-actionable asks: autonomy (retries bounded by maxAgentTurns).
		if (ask !== "tool" && ask !== "command" && ask !== "use_mcp_server") {
			return "approve"
		}

		// Read-only tool actions are pre-approved (reads/searches are safe).
		if (ask === "tool") {
			let parsed: ClineSayTool | undefined
			try {
				parsed = JSON.parse(text ?? "{}") as ClineSayTool
			} catch {
				// Unparseable tool ask — fail-safe deny: a malformed write must
				// not slip past the user's write policy.
				return "deny"
			}
			if (parsed && isReadOnlyToolAction(parsed)) {
				return "approve"
			}
		}

		// Writes (anywhere — worktree isolation is not consent), commands, and
		// MCP calls follow the user's configured auto-approval policy.
		const result = await checkAutoApproval({ state: await getState(), ask, text, isProtected })
		if (result.decision === "approve") {
			return "approve"
		}
		if (result.decision === "deny") {
			return "deny"
		}
		// "ask" / "timeout": a real permission decision — surface it in the
		// subagents panel via the normal blocking flow. TaskAskSay bounds the
		// wait and denies if nobody answers.
		return undefined
	}
}
