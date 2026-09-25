import { getToolPayloadKind, type ToolPayloadKind } from "@roo-code/core/cli"

import type { BulletStatus } from "../primitives/Bullet.js"
import type { ToolData, TUIMessage } from "../../types.js"

export interface ToolRendererProps {
	toolData: ToolData
	rawContent?: string
	/** The originating message, so renderers can read partial/hasPendingToolCalls for bullet status. */
	message?: TUIMessage
	/**
	 * Verbose rendering: lift the renderer's own preview caps so the whole
	 * output is printed. In the dynamic tail it is set only with the output
	 * already cut to the tail's row budget, so the tail stays clamped (plans:
	 * 2026-09-21 answer lost in dynamic tail, I1; 2026-09-23 cli live block
	 * under ctrl+o).
	 */
	expanded?: boolean
}

export type ToolCategory = "file-read" | "file-write" | "search" | "command" | "mode" | "completion" | "other"

/**
 * Derive the bullet status for a tool from its originating message.
 * Running while pending/partial; otherwise success (tool messages are
 * only ever added as completed — there is no error signal in the
 * current message flow; see agent/transcript-reducer.ts).
 */
export function toolStatusFromMessage(message?: TUIMessage): BulletStatus {
	if (message?.hasPendingToolCalls || message?.partial) {
		return "running"
	}
	return "success"
}

/** The CLI renderer of each payload row family (see ToolPayloadKind in @roo-code/core). */
const KIND_CATEGORIES: Partial<Record<ToolPayloadKind, ToolCategory>> = {
	edit: "file-write",
	insert: "file-write",
	readFile: "file-read",
	listFiles: "file-read",
	searchFiles: "search",
	codebaseSearch: "search",
	switchMode: "mode",
}

/** The rows the CLI builds itself, which carry no payload of the extension's. */
const CLI_ROW_CATEGORIES: Record<string, ToolCategory> = {
	execute_command: "command",
	attempt_completion: "completion",
}

export function getToolCategory(toolName: string): ToolCategory {
	const kind = getToolPayloadKind(toolName)
	const category = kind
		? KIND_CATEGORIES[kind]
		: Object.hasOwn(CLI_ROW_CATEGORIES, toolName)
			? CLI_ROW_CATEGORIES[toolName]
			: undefined
	return category ?? "other"
}
