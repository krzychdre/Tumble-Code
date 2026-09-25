import type { ClineSayTool } from "@roo-code/types"

import { TOOL_DESCRIPTORS, type ToolApprovalCategory } from "../tools/toolDescriptors"

/**
 * Actions a "tool" ask can carry that no tool descriptor declares.
 */
const NON_TOOL_ACTION_CATEGORIES: ReadonlyArray<readonly [string, ToolApprovalCategory]> = [
	// The plan-review pause (src/core/plan-review) after a write tool saved a plan file.
	["reviewPlan", "planReview"],
	// No tool sends it any more (list_files sends listFilesTopLevel or listFilesRecursive);
	// kept read-only so no decision changes.
	["listFiles", "readOnly"],
]

/**
 * The approval category of every action a "tool" ask can carry, derived from the
 * `approvalActions` each tool descriptor declares. A Map, so a model-influenced action such
 * as `constructor` or `__proto__` never finds an entry through the prototype chain.
 */
export const TOOL_ACTION_APPROVAL_CATEGORIES: ReadonlyMap<string, ToolApprovalCategory> = new Map([
	...NON_TOOL_ACTION_CATEGORIES,
	...Object.values(TOOL_DESCRIPTORS).flatMap((descriptor) =>
		(descriptor.approvalActions ?? []).map((action) => [action, descriptor.approvalCategory] as const),
	),
])

/** The category of the action a parsed "tool" ask carries; undefined when it has none. */
export function getToolActionApprovalCategory(tool: ClineSayTool | undefined): ToolApprovalCategory | undefined {
	const action: unknown = tool?.tool
	return typeof action === "string" ? TOOL_ACTION_APPROVAL_CATEGORIES.get(action) : undefined
}

export function isWriteToolAction(tool: ClineSayTool): boolean {
	return getToolActionApprovalCategory(tool) === "write"
}

export function isReadOnlyToolAction(tool: ClineSayTool): boolean {
	return getToolActionApprovalCategory(tool) === "readOnly"
}
