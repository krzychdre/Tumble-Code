import { isCompactProfile, type ToolName } from "@tumble-code/types"

import { toolNamesWhere } from "../tools/toolDescriptors"

/**
 * Tools that get a checkpoint saved before they run, so the user can restore the
 * workspace to the state it had before the tool acted.
 *
 * This is the single list for both places that act on it:
 * - presentAssistantMessage saves the checkpoint right before running the tool;
 * - TaskStreamProcessor starts that same save early, when the tool call begins
 *   streaming, so it overlaps the streaming of the tool's arguments.
 *
 * Derived from the `requiresCheckpoint` column of the tool descriptor table
 * (`src/core/tools/toolDescriptors.ts`). `new_task` is included by decision
 * (refactor plan, decision 9): a subtask can change the workspace before
 * control returns.
 */
export const CHECKPOINTED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(
	toolNamesWhere((tool) => tool.requiresCheckpoint),
)

export function isCheckpointedTool(name: string): boolean {
	return CHECKPOINTED_TOOLS.has(name as ToolName)
}

/**
 * Whether a call to `name` by a task on the profile `settings` (the task's own
 * `apiConfiguration`) gets a checkpoint before it runs. Both call sites go
 * through this, so they keep agreeing.
 *
 * Under a compact profile `new_task` is refused before it acts (subagents are
 * off there, see `NewTaskTool`), so it gets no checkpoint: the refusal leaves
 * no trace beyond its tool error. Otherwise the same as `isCheckpointedTool`.
 */
export function isCheckpointedCall(name: string, settings?: { compactProfile?: boolean } | null): boolean {
	if (name === "new_task" && isCompactProfile(settings)) {
		return false
	}
	return isCheckpointedTool(name)
}
