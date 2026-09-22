import { memo, useMemo } from "react"
import { Box, Text } from "ink"

import type { TUIMessage } from "../types.js"
import { clampTail } from "../utils/tailClamp.js"

import ChatHistoryItem from "./ChatHistoryItem.js"
import AssistantMessage from "./messages/AssistantMessage.js"

interface DynamicTailMessageProps {
	message: TUIMessage
	/** Physical-row budget for this message's body. */
	maxRows: number
	/** Terminal width, for wrap-aware clamping. */
	columns: number
	/**
	 * `message.content` is only the unprinted rest of a streaming answer whose
	 * finished lines are already in scrollback (see `streamCommit.ts`): render
	 * it as the continuation of that text, without a bullet of its own.
	 */
	continuation?: boolean
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
function DynamicTailMessage({ message, maxRows, columns, continuation = false }: DynamicTailMessageProps) {
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

	const body = (shown: TUIMessage) =>
		continuation ? <AssistantMessage content={shown.content} continuation /> : <ChatHistoryItem message={shown} />

	if (!clamped) {
		return body(message)
	}

	return (
		<Box flexDirection="column">
			<Box marginTop={continuation ? 0 : 1} paddingLeft={2}>
				{/* The suffix answers the obvious question: there is no expand
				    affordance here on purpose, because an unclamped body in the
				    tail is exactly what breaks ink's erase (I1). The full text
				    prints into scrollback when the message is promoted. */}
				<Text dimColor>… +{clamped.hiddenLines} lines (prints in full when this message completes)</Text>
			</Box>
			{body(clamped.message)}
		</Box>
	)
}

export default memo(DynamicTailMessage)
