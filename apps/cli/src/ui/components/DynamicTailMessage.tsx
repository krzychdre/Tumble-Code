import { memo, useMemo } from "react"
import { Box, Text } from "ink"

import type { TUIMessage } from "../types.js"
import { clampTail } from "../utils/tailClamp.js"

import ChatHistoryItem from "./ChatHistoryItem.js"

interface DynamicTailMessageProps {
	message: TUIMessage
	/** Physical-row budget for this message's body. */
	maxRows: number
	/** Terminal width, for wrap-aware clamping. */
	columns: number
}

/** Roles with unbounded bodies. Tool renderers cap their own previews and
 * "thinking" is a one-liner, so only these need clamping. */
const CLAMPED_ROLES = new Set<TUIMessage["role"]>(["assistant", "user", "system"])

/**
 * Dynamic-tail wrapper around `ChatHistoryItem` that clamps unbounded message
 * bodies to a row budget. If the dynamic tail outgrows the terminal, ink's
 * erase sequences miss the rows that scrolled out of the viewport, leaving
 * permanent duplicates in scrollback (plan: 2026-08-07 clamp dynamic tail).
 * The full body still prints once when the message is promoted to `<Static>`.
 */
function DynamicTailMessage({ message, maxRows, columns }: DynamicTailMessageProps) {
	const clamped = useMemo(() => {
		if (!CLAMPED_ROLES.has(message.role)) {
			return null
		}
		const result = clampTail(message.content, maxRows, columns)
		if (result.hiddenLines === 0) {
			return null
		}
		return { message: { ...message, content: result.content }, hiddenLines: result.hiddenLines }
	}, [message, maxRows, columns])

	if (!clamped) {
		return <ChatHistoryItem message={message} />
	}

	return (
		<Box flexDirection="column">
			<Box marginTop={1} paddingLeft={2}>
				<Text dimColor>… +{clamped.hiddenLines} lines</Text>
			</Box>
			<ChatHistoryItem message={clamped.message} />
		</Box>
	)
}

export default memo(DynamicTailMessage)
