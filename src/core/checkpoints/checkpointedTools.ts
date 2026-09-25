import type { ToolName } from "@roo-code/types"

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
 * (`src/core/tools/toolDescriptors.ts`). `new_task` and `generate_image` are
 * included by decision (refactor plan, decision 9): a subtask can change the
 * workspace before control returns, and generate_image writes the image file.
 */
export const CHECKPOINTED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(
	toolNamesWhere((tool) => tool.requiresCheckpoint),
)

export function isCheckpointedTool(name: string): boolean {
	return CHECKPOINTED_TOOLS.has(name as ToolName)
}
