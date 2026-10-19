/**
 * The texts the parent model reads about its parallel subagents: the results
 * of the ones that finished, the list of the ones still running and what to
 * do next. Shared by run_parallel_tasks, wait_for_subagents and the delivery
 * of results to a parent whose turn already ended (BackgroundSubagents).
 *
 * Written for weak models: short sentences, one instruction each.
 */

/** Outcome of a single subtask run. */
export interface ParallelSubtaskResult {
	/** Position of the subtask in its run_parallel_tasks call (worktree names use it). */
	index: number
	mode: string
	status: "completed" | "failed" | "cancelled"
	worktreePath?: string
	branch?: string
	message?: string
	error?: string
	/** Worktree + branch removed because nothing reviewable was produced. */
	cleaned?: boolean
}

/** A subagent as the parent model knows it: its number in the task and what it was asked to do. */
export interface SubagentRef {
	/** Counts the subagents of one parent task from 1, across all its run_parallel_tasks calls. */
	number: number
	description: string
	mode: string
}

/** A subagent that ended, with its outcome. */
export interface FinishedSubagent extends SubagentRef {
	result: ParallelSubtaskResult
}

/** Render the outcomes of finished subagents, one block each. */
export function formatParallelResults(finished: ReadonlyArray<FinishedSubagent>): string {
	const results = finished.map((f) => f.result)
	const completed = results.filter((r) => r.status === "completed").length
	const failed = results.filter((r) => r.status === "failed").length
	const cancelled = results.filter((r) => r.status === "cancelled").length

	const summaryParts = [`${completed} completed`, `${failed} failed`]
	if (cancelled > 0) summaryParts.push(`${cancelled} cancelled`)
	const lines: string[] = [
		`${finished.length} subagent(s) finished: ${summaryParts.join(", ")}.`,
		"Worktrees with changes are kept for review; empty ones were removed. Nothing was merged.",
		"",
	]
	for (const { number, description, result: r } of finished) {
		lines.push(`### Subagent #${number}: ${r.status.toUpperCase()} (${r.mode} mode)`)
		lines.push(`- task: ${description}`)
		if (r.cleaned) {
			lines.push("- worktree: cleaned up (no changes)")
		} else if (r.worktreePath) {
			lines.push(`- worktree: ${r.worktreePath}${r.branch ? ` (branch: ${r.branch})` : ""}`)
		}
		if (r.status === "completed") {
			lines.push("", r.message?.trim() || "(no result message)")
		} else if (r.status === "cancelled") {
			lines.push("", "Cancelled before completion.")
		} else {
			lines.push("", `Failed: ${r.error ?? "unknown error"}`)
			if (r.message?.trim()) {
				lines.push("", "Its last message before it stopped:", "", r.message.trim())
			}
		}
		lines.push("", "---", "")
	}
	return lines.join("\n").trimEnd()
}

/** One line per running subagent: `#3 <description> (code mode)`. */
export function formatSubagentList(subagents: ReadonlyArray<SubagentRef>): string {
	return subagents.map((s) => `- #${s.number} ${s.description} (${s.mode} mode)`).join("\n")
}

/**
 * The results of the subagents that just finished, the ones still running,
 * and the next step. The next step differs when every subagent reported.
 */
export function formatSubagentUpdate(
	finished: ReadonlyArray<FinishedSubagent>,
	stillRunning: ReadonlyArray<SubagentRef>,
): string {
	const parts = [formatParallelResults(finished), ""]
	if (stillRunning.length === 0) {
		parts.push("Every subagent has reported. No subagent is running now.")
		return parts.join("\n")
	}
	parts.push(
		`Still running (${stillRunning.length}):`,
		formatSubagentList(stillRunning),
		"",
		"Next step:",
		"- If a result above unblocks a follow-up job, start it now with run_parallel_tasks. It runs alongside the others.",
		"- Otherwise call wait_for_subagents to get the next result.",
		"- Do not redo the work of a subagent that is still running.",
		"- Do not call attempt_completion before every subagent has reported.",
	)
	return parts.join("\n")
}

/** The tool result of a wait that the user's message interrupted. */
export function formatUserMessageWhileWaiting(text: string, runningCount: number, unreadCount: number): string {
	const lines = [
		"The user sent you a message while your subagents work:",
		"",
		`<user_message>\n${text}\n</user_message>`,
		"",
		"Answer the user's message now.",
	]
	if (runningCount > 0) {
		lines.push(`${runningCount} subagent(s) keep running in the background.`)
	}
	if (unreadCount > 0) {
		lines.push(`${unreadCount} subagent result(s) are ready and not read yet.`)
	}
	lines.push("After you answer, call wait_for_subagents to collect their results.")
	return lines.join("\n")
}

/** The tool result of a wait with nothing to wait for. */
export const NOTHING_TO_WAIT_FOR =
	"No subagent is running and no result is waiting. Do not call wait_for_subagents again now. Continue with your task."
