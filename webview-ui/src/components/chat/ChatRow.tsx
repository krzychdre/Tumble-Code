import React, { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useSize } from "react-use"
import deepEqual from "fast-deep-equal"

import type { ClineMessage, SuggestionItem, ClineSayTool } from "@roo-code/types"

import { safeJsonParse } from "@roo-code/core/browser"

import type { RowMetaEntry } from "./rows/computeRowMeta"
import type { RowRendererProps, ToolAskKind } from "./rows/renderers/types"
import { TOOL_RENDERERS } from "./rows/renderers/tool"
import { SAY_RENDERERS, DefaultSayRow } from "./rows/renderers/say"
import { ASK_RENDERERS } from "./rows/renderers/ask"

interface ChatRowProps {
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

const EMPTY_META: RowMetaEntry = {
	nextTs: undefined,
	previousTodos: [],
	newTaskIndex: undefined,
	followedBySubtaskResult: false,
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div className="px-[15px] py-[10px] pr-[6px]">
				<ChatRowContent {...props} />
			</div>,
		)

		useEffect(() => {
			const isHeightValid = height !== 0 && height !== Infinity
			// used for partials, command output, etc.
			// NOTE: it's important we don't distinguish between partial or complete here since our scroll effects in chatview need to handle height change during partial -> complete
			const isInitialRender = prevHeightRef.current === 0 // prevents scrolling when new element is added since we already scroll for that
			// height starts off at Infinity
			if (isLast && isHeightValid && height !== prevHeightRef.current) {
				if (!isInitialRender) {
					onHeightChange(height > prevHeightRef.current)
				}
				prevHeightRef.current = height
			}
		}, [height, isLast, onHeightChange, message])

		// we cannot return null as virtuoso does not support it, so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = ({
	message,
	lastModifiedMessage,
	isExpanded,
	isLast,
	isStreaming,
	supportsImages,
	onToggleExpand,
	onSuggestionClick,
	onFollowUpUnmount,
	onBatchFileResponse,
	isFollowUpAnswered,
	isFollowUpAutoApprovalPaused,
	onJumpToPreviousCheckpoint,
	meta = EMPTY_META,
}: ChatRowContentProps) => {
	// Memoized callback to prevent re-renders caused by inline arrow functions.
	// The target state is passed explicitly and derived from what is on screen,
	// not from the parent's map: a row that opens by default (a command ask
	// waiting for approval) has no entry there yet, so a bare flip would compute
	// !undefined === true and leave the row open on the first click. For rows
	// without a default the result is the same as flipping the stored value.
	const toggleExpand = useCallback(() => {
		onToggleExpand(message.ts, !isExpanded)
	}, [onToggleExpand, message.ts, isExpanded])

	const tool = useMemo(
		() => (message.ask === "tool" ? safeJsonParse<ClineSayTool>(message.text) : null),
		[message.ask, message.text],
	)

	const rendererProps: RowRendererProps = {
		message,
		lastModifiedMessage,
		isExpanded,
		isLast,
		isStreaming,
		supportsImages,
		toggleExpand,
		onSuggestionClick,
		onBatchFileResponse,
		onFollowUpUnmount,
		isFollowUpAnswered,
		isFollowUpAutoApprovalPaused,
		onJumpToPreviousCheckpoint,
		meta,
	}

	// A tool ask whose payload parses renders by its tool name; one that does
	// not parse falls through to the ask renderers (which have no "tool" entry).
	if (tool) {
		const ToolRenderer = TOOL_RENDERERS[tool.tool as ToolAskKind]
		return ToolRenderer ? <ToolRenderer {...rendererProps} tool={tool} /> : null
	}

	if (message.type === "say") {
		const SayRenderer = (message.say && SAY_RENDERERS[message.say]) || DefaultSayRow
		return <SayRenderer {...rendererProps} />
	}

	if (message.type === "ask") {
		const AskRenderer = message.ask && ASK_RENDERERS[message.ask]
		return AskRenderer ? <AskRenderer {...rendererProps} /> : null
	}

	return null
}
