/**
 * Subagents under the compact profile (small local models, see
 * `ai_plans/2026-10-10_19-36_compact-small-model-profile.md`).
 *
 * The compact toolset does not offer `new_task` or `run_parallel_tasks`, but
 * dispatch is tolerant: a hidden tool the model calls anyway still runs. The
 * subagent settings (`parallelTasksMaxConcurrency` and the others) are global,
 * so they cannot be turned off for one profile. Both tools therefore refuse the
 * call at runtime when `isCompactProfile(task.apiConfiguration)` holds, before
 * any approval ask, child task or mode switch.
 */

/** The subagent tools that a task on a compact profile may not run. */
export type CompactRefusedSubagentTool = "new_task" | "run_parallel_tasks"

/**
 * The plain-English tool error for a subagent tool called by a task on a
 * compact profile: what happened and what to do instead, in words a 4B model
 * follows. Wrapped by the caller in `formatResponse.toolError` without the tool
 * name, so no minimal example of the refused tool is attached.
 */
export function compactSubagentsOffError(toolName: CompactRefusedSubagentTool): string {
	return (
		`${toolName} refused: subagents are off for this profile (compact mode). ` +
		"Do the work yourself with your own tools, then call attempt_completion."
	)
}
