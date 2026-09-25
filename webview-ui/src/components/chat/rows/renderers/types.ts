import type React from "react"

import type { ClineAsk, ClineMessage, ClineSay, ClineSayTool, SuggestionItem } from "@roo-code/types"

import type { RowMetaEntry } from "../computeRowMeta"

/** What every row renderer receives from ChatRowContent. */
export interface RowRendererProps {
	message: ClineMessage
	lastModifiedMessage?: ClineMessage
	isExpanded: boolean
	isLast: boolean
	isStreaming: boolean
	/** Whether the selected model takes images (the edit box of a user message needs it). */
	supportsImages?: boolean
	/** Flips this row's expanded state (already bound to the row's ts). */
	toggleExpand: () => void
	onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	onFollowUpUnmount?: () => void
	isFollowUpAnswered?: boolean
	isFollowUpAutoApprovalPaused?: boolean
	onJumpToPreviousCheckpoint?: () => void
	/** What the row needs from the history around it (computeRowMeta). */
	meta: RowMetaEntry
}

/** A tool payload row: a tool ask, or a say "tool" message. */
export interface ToolRendererProps extends RowRendererProps {
	tool: ClineSayTool
}

export type RowRenderer = React.ComponentType<RowRendererProps>
export type ToolRenderer = React.ComponentType<ToolRendererProps>

/**
 * Tool names a tool ask can carry. Besides ClineSayTool["tool"], the edit
 * family answers to the names older builds and other edit tools emitted.
 */
export type ToolAskKind =
	| ClineSayTool["tool"]
	| "searchAndReplace"
	| "search_and_replace"
	| "search_replace"
	| "edit"
	| "edit_file"
	| "apply_patch"
	| "apply_diff"
	| "insertContent"

export type SayRendererMap = Partial<Record<ClineSay, RowRenderer>>
export type AskRendererMap = Partial<Record<ClineAsk, RowRenderer>>
export type ToolRendererMap = Partial<Record<ToolAskKind, ToolRenderer>>
export type SayToolRendererMap = Partial<Record<ClineSayTool["tool"], ToolRenderer>>
