import type { RowMetaEntry } from "./rows/computeRowMeta"
import type { ChatRowProps } from "./chatRowProps"

/**
 * P2 targeted memo comparator for ChatRow (roadmap step ③). Replaces
 * fast-deep-equal, which walked the whole props tree — message payloads
 * included — for every visible row on every streamed token.
 *
 * What the row renders (audit in ai_plans/2026-09-28_p2-chatrow-targeted-comparator.md):
 * - `message`: never mutated in place (the store replaces slots, the row
 *   pipeline caches its synthesized rows), so equal references render
 *   identically. `consolidateCommands`/`consolidateApiRequests` rebuild
 *   command/api_req rows per recompute with fresh identities, so when the
 *   references differ we compare `ts` + `text` + `partial`: those are the
 *   fields that change while a row streams; every other rendered field
 *   (`images`, `checkpoint`, `say`, `ask`, `type`, …) changes only together
 *   with the text or arrives on a new message object from the host.
 * - `meta`: computeRowMeta builds fresh entries per recompute, so compare the
 *   four fields; `previousTodos` is reference-stable through parseToolCached.
 * - everything else is a primitive or a stabilized callback: `===`.
 */
const metaEqual = (prev: RowMetaEntry | undefined, next: RowMetaEntry | undefined): boolean => {
	if (prev === next) {
		return true
	}
	if (!prev || !next) {
		return false
	}
	return (
		prev.nextTs === next.nextTs &&
		prev.previousTodos === next.previousTodos &&
		prev.newTaskIndex === next.newTaskIndex &&
		prev.followedBySubtaskResult === next.followedBySubtaskResult
	)
}

const messageEqual = (prev: ChatRowProps["message"], next: ChatRowProps["message"]): boolean =>
	prev === next || (prev.ts === next.ts && prev.partial === next.partial && prev.text === next.text)

export function chatRowPropsEqual(prev: ChatRowProps, next: ChatRowProps): boolean {
	return (
		messageEqual(prev.message, next.message) &&
		prev.lastModifiedMessage === next.lastModifiedMessage &&
		prev.isExpanded === next.isExpanded &&
		prev.isLast === next.isLast &&
		prev.isStreaming === next.isStreaming &&
		prev.supportsImages === next.supportsImages &&
		prev.onToggleExpand === next.onToggleExpand &&
		prev.onHeightChange === next.onHeightChange &&
		prev.onSuggestionClick === next.onSuggestionClick &&
		prev.onBatchFileResponse === next.onBatchFileResponse &&
		prev.onFollowUpUnmount === next.onFollowUpUnmount &&
		prev.isFollowUpAnswered === next.isFollowUpAnswered &&
		prev.isFollowUpAutoApprovalPaused === next.isFollowUpAutoApprovalPaused &&
		prev.onJumpToPreviousCheckpoint === next.onJumpToPreviousCheckpoint &&
		metaEqual(prev.meta, next.meta)
	)
}
