/**
 * The auto-approval policy for headless parallel-subagent children.
 *
 * Each subagent runs in its own git worktree as a background task. Unlike the
 * memory writer (which is write-confined to a single directory and denies
 * commands outright), a subagent does real work: it may run shell commands,
 * call MCP servers, and edit files inside its worktree. The user's configured
 * auto-approval policy — command allow/deny lists, MCP toggles, protected-file
 * guards — must be honoured, because one upfront approval of subtask
 * descriptions is not informed consent for unsupervised arbitrary command
 * execution.
 *
 * Policy (fail-safe — the override must ALWAYS decide, never return `undefined`,
 * or a headless child would block forever on a webview response it can never
 * receive):
 * - non-`tool`/`command`/`use_mcp_server` asks (followup, completion_result,
 *   api_req_failed, resume, …) → `"approve"` (autonomy; retries stay bounded
 *   by `maxAgentTurns`);
 * - read-only tool actions → `"approve"` (reads/searches are safe anywhere);
 * - tool asks whose target path resolves inside the child's worktree →
 *   `"approve"` (the isolation contract the user accepted at fan-out time:
 *   edits confined to a throwaway worktree) — except protected files
 *   (`.rooignore`, `.roo*` config), which follow the user's protected-write
 *   setting via delegation;
 * - everything else (commands, MCP, writes outside the worktree, path-less
 *   writes) → delegate to `checkAutoApproval` with the user's live
 *   state; `"approve"` passes through, `"deny"` / `"ask"` / `"timeout"` all
 *   map to `"deny"` (a headless child has no user to ask and must never wait
 *   on a timeout designed for a visible countdown).
 */

import * as path from "path"

import type { ClineAsk, ClineSayTool, ExtensionState } from "@roo-code/types"

import { checkAutoApproval, type AutoApprovalState, type AutoApprovalStateOptions } from "../auto-approval"
import { isReadOnlyToolAction } from "../auto-approval/tools"
import type { AutoApprovalOverride } from "./Task"

/** State slice consumed by `checkAutoApproval`. */
type ApprovalState = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions>

/** Options for building a subagent approval policy. */
export interface SubagentApprovalOptions {
	/** Accessor for the live extension state (delegated asks consult it). */
	getState: () => Promise<ApprovalState>
	/** Absolute path of the child's worktree — writes inside it are pre-approved. */
	worktreePath: string
}

/**
 * Build the auto-approval policy for a headless parallel-subagent child.
 * The returned function always decides (`"approve"` or `"deny"`, never
 * `undefined`) so the child can never block on a webview response.
 */
export function buildSubagentApprovalPolicy(options: SubagentApprovalOptions): AutoApprovalOverride {
	const { getState, worktreePath } = options
	// Pre-compute the separator-terminated prefix for containment checks.
	const prefix = path.normalize(worktreePath) + path.sep

	return async (ask, text, isProtected) => {
		// Non-actionable asks: autonomy (retries bounded by maxAgentTurns).
		if (ask !== "tool" && ask !== "command" && ask !== "use_mcp_server") {
			return "approve"
		}

		// Tool asks: read-only actions and worktree-contained writes are pre-approved.
		if (ask === "tool") {
			let parsed: ClineSayTool | undefined
			try {
				parsed = JSON.parse(text ?? "{}") as ClineSayTool
			} catch {
				// Unparseable tool ask — approve conservatively (reads are the
				// common case; a write would still be caught below only if parseable).
				return "approve"
			}
			if (parsed && isReadOnlyToolAction(parsed)) {
				return "approve"
			}
			// Protected files (.rooignore, .roo* config) keep the user's
			// protected-write guard even inside the worktree — delegate below.
			const p = parsed?.path
			if (
				!isProtected &&
				typeof p === "string" &&
				p.length > 0 &&
				isInsideWorktree(path.resolve(worktreePath, p), prefix)
			) {
				return "approve"
			}
		}

		// Commands, MCP, and tool writes outside the worktree: delegate to the
		// user's configured auto-approval policy.
		const result = await checkAutoApproval({ state: await getState(), ask, text, isProtected })
		// "ask" / "timeout" map to deny — a headless child has no user to ask.
		return result.decision === "approve" ? "approve" : "deny"
	}
}

/**
 * Containment check: does `absolutePath` live inside the worktree? Uses a
 * separator-terminated prefix so `/wt/evil` cannot match a worktree at `/wt`.
 */
function isInsideWorktree(absolutePath: string, prefix: string): boolean {
	const normalized = path.normalize(absolutePath)
	if (normalized === prefix.slice(0, -1)) return true // the worktree dir itself
	return normalized.startsWith(prefix)
}
