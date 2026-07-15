import * as path from "path"

import type { Task } from "../task/Task"
import { PlanReviewPanel } from "../webview/PlanReviewPanel"
import { isPlanReviewFileOpen } from "../webview/planReviewRegistry"
import { isPlanFilePath } from "../../shared/planFiles"

/**
 * After a write tool successfully saves a plan file, block the task until the
 * user reviews and approves (or sends feedback on) the updated plan. The panel
 * is auto-opened so the user sees the finished plan, not a diff preview.
 *
 * Returns a string to append to the tool result when the pause completed
 * (approved or feedback), or `undefined` when the pause was skipped.
 *
 * Skipped when:
 *   - the written file is not a plan file (path heuristic) and not open in a
 *     Plan Review panel,
 *   - no provider is available (headless early-exit),
 *   - `alwaysApprovePlan` is true (user opted out of plan review),
 *   - `autoApprovalMode` is `autonomous` (unattended runs),
 *   - the task is a background/headless subagent (`isBackground`) — background
 *     tasks must never hang waiting for a user who isn't watching.
 *
 * Bypass mode does NOT skip the pause — it only force-approves other tool asks;
 * the plan review pause is a first-class gate that survives bypass (consistent
 * with the V1 mode-exit gate).
 */
export async function pauseForPlanReviewIfNeeded(task: Task, toolRelPath: string): Promise<string | undefined> {
	try {
		const absPath = path.resolve(task.cwd, toolRelPath)

		// Eligible: matches the plan-file path heuristic OR already open in a
		// Plan Review panel (the user manually started reviewing it).
		const eligible = isPlanFilePath(absPath, task.cwd) || isPlanReviewFileOpen(absPath)
		if (!eligible) {
			return undefined
		}

		const provider = task.providerRef.deref()
		if (!provider) {
			return undefined
		}

		const state = await provider.getState()

		// Skip when the user opted out of plan review entirely.
		if (state.alwaysApprovePlan === true) {
			return undefined
		}

		// Autonomous mode runs unattended — never block.
		if (state.autoApprovalMode === "autonomous") {
			return undefined
		}

		// Background/headless subagents must never hang waiting for a user.
		if (task.isBackground) {
			return undefined
		}

		// Open/reveal the Plan Review panel BEFORE asking so the user sees
		// the finished plan immediately.
		await PlanReviewPanel.open(provider.context, { filePath: absPath })

		// Block on an ask — the webview shows approve/reject buttons. The
		// annotation panel's "Send notes" resolves this pending ask as a
		// messageResponse, so notes ARE the review response.
		const { response, text, images } = await task.ask(
			"tool",
			JSON.stringify({ tool: "reviewPlan", path: toolRelPath }),
			false,
		)

		let result: string

		if (response === "yesButtonClicked") {
			// The user may have drafted annotation notes in the panel and clicked
			// Approve instead of the panel's Send button — the notes ARE the
			// review response, so deliver them as corrections.
			const draftNotes = PlanReviewPanel.consumeDraftNotes(absPath)
			if (draftNotes) {
				await task.say("user_feedback", draftNotes)
				result =
					"The user reviewed the updated plan and responded with the following notes:\n<user_message>\n" +
					draftNotes +
					"\n</user_message>\nAddress these notes and update the plan."
			} else {
				result = "The user reviewed the updated plan and approved it."
			}
		} else if (text) {
			// messageResponse / noButtonClicked with text: treat as feedback.
			await task.say("user_feedback", text, images)
			result = "The user reviewed the updated plan and responded:\n<user_message>\n" + text + "\n</user_message>"
		} else {
			// Plain reject with no text.
			result = "The user rejected the plan update. Wait for further instructions or ask a clarifying question."
		}

		// The review round is resolved (Approve/Deny/notes) — close the panel.
		// Already-disposed panels (e.g. Send notes disposed it) are a no-op.
		PlanReviewPanel.closeForFile(absPath)

		return result
	} catch (error) {
		// The pause must never crash a write tool — log and continue.
		const provider = task.providerRef.deref()
		if (provider?.log) {
			provider.log(`[planReviewPause] error: ${error instanceof Error ? error.message : String(error)}`)
		}
		return undefined
	}
}
