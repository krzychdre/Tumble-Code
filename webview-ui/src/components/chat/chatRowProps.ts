import type { ClineMessage, SuggestionItem } from "@tumble-code/types"

import type { RowMetaEntry } from "./rows/computeRowMeta"

/** ChatRow's props. Lives beside the targeted memo comparator
 * (chatRowPropsEqual.ts) so the comparator can import the type without a
 * cycle back into ChatRow.tsx. */
export interface ChatRowProps {
	message: ClineMessage
	lastModifiedMessage?: ClineMessage
	isExpanded: boolean
	isLast: boolean
	isStreaming: boolean
	// Whether the selected model takes images; ChatView computes it once for
	// all rows (the edit box of a user message needs it).
	supportsImages?: boolean
	onToggleExpand: (ts: number, expand?: boolean) => void
	onHeightChange: (isTaller: boolean) => void
	onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	onFollowUpUnmount?: () => void
	isFollowUpAnswered?: boolean
	isFollowUpAutoApprovalPaused?: boolean
	onJumpToPreviousCheckpoint?: () => void
	// What the row needs from the history around it (next message's ts,
	// previous todo list, newTask position). ChatView computes it once per
	// history change (computeRowMeta), so the row never scans clineMessages.
	meta?: RowMetaEntry
}
