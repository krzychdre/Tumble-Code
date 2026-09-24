/**
 * Pure helpers over a parent task's persisted API messages, shared by the
 * delegation paths in ClineProvider (tryReattachDelegatedParent and
 * reopenParentFromDelegation). They take plain arrays so they can be tested
 * without a provider.
 */

interface ApiMessageLike {
	role?: unknown
	content?: unknown
}

interface ContentBlockLike {
	type?: unknown
	name?: unknown
	id?: unknown
	tool_use_id?: unknown
}

function blocksOf(message: ApiMessageLike | undefined): ContentBlockLike[] | undefined {
	return Array.isArray(message?.content) ? (message.content as ContentBlockLike[]) : undefined
}

/**
 * Scans backward for the most recent assistant `new_task` tool_use.
 *
 * Only the first `new_task` block of each assistant message is considered;
 * if that block has no id the scan continues with earlier messages. This
 * matches the loops the delegation code used before the extraction.
 */
export function findLastNewTaskToolUse(
	messages: readonly ApiMessageLike[],
): { toolUseId: string; messageIndex: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		const blocks = blocksOf(message)
		if (message?.role !== "assistant" || !blocks) {
			continue
		}
		const block = blocks.find((b) => b?.type === "tool_use" && b.name === "new_task")
		if (block && typeof block.id === "string" && block.id) {
			return { toolUseId: block.id, messageIndex: i }
		}
	}
	return undefined
}

/**
 * True when a user message at or after `fromIndex` carries a `tool_result`
 * answering `toolUseId`.
 */
export function hasToolResultFor(messages: readonly ApiMessageLike[], toolUseId: string, fromIndex = 0): boolean {
	for (let i = Math.max(0, fromIndex); i < messages.length; i++) {
		const message = messages[i]
		const blocks = blocksOf(message)
		if (message?.role !== "user" || !blocks) {
			continue
		}
		if (blocks.some((b) => b?.type === "tool_result" && b.tool_use_id === toolUseId)) {
			return true
		}
	}
	return false
}

/** The text a parent receives when its delegated subtask completes. */
export function formatSubtaskResult(childTaskId: string, completionResultSummary: string): string {
	return `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
}
