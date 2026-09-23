import { memo, useMemo } from "react"
import { Box, Text } from "ink"

import type { TUIMessage } from "../types.js"
import { clampTail, hiddenLinesMarker } from "../utils/tailClamp.js"

import ChatHistoryItem from "./ChatHistoryItem.js"
import AssistantMessage from "./messages/AssistantMessage.js"
import { sanitizeContent } from "./primitives/ResultRow.js"

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
	/**
	 * The expanded transcript (ctrl+o) is on: show the growing body of a
	 * running block as a window of its newest rows (see `liveWindow`).
	 */
	expanded?: boolean
}

/** Roles with unbounded bodies. Tool renderers cap their own previews and
 * "thinking" is a one-liner in the collapsed transcript, so only these need
 * clamping there. The expanded transcript clamps through `liveWindow`. */
const CLAMPED_ROLES = new Set<TUIMessage["role"]>(["assistant", "user", "system"])

/** Columns in front of a tool row's output: the bullet (2) and the `  ⎿  ` gutter (5). */
const TOOL_OUTPUT_INDENT = 7

/** Columns in front of an expanded thinking body. */
const THINKING_INDENT = 4

/** Rows of a live window that are not its body: the block's header and the marker. */
const LIVE_WINDOW_CHROME_ROWS = 2

interface LiveBody {
	text: string
	/** Columns the renderer puts in front of the body. */
	indent: number
	/** The message with its body replaced by `text`. */
	withText: (text: string) => TUIMessage
}

/**
 * The part of a message that keeps growing while its block runs: the
 * reasoning of a thinking message, the output of a command, the response of
 * an MCP call. Other tool rows arrive complete, so in the tail they keep
 * their collapsed preview and print expanded once promoted.
 */
function liveBody(message: TUIMessage): LiveBody | null {
	if (message.role === "thinking") {
		return {
			text: message.content,
			indent: THINKING_INDENT,
			withText: (text) => ({ ...message, content: text }),
		}
	}

	const toolData = message.role === "tool" ? message.toolData : undefined

	if (toolData?.tool === "execute_command") {
		return {
			// CommandTool prints `output`, falling back to `content`.
			text: toolData.output || toolData.content || "",
			indent: TOOL_OUTPUT_INDENT,
			withText: (text) => ({ ...message, toolData: { ...toolData, output: text } }),
		}
	}

	if (toolData?.tool === "use_mcp_server") {
		return {
			text: toolData.content || "",
			indent: TOOL_OUTPUT_INDENT,
			withText: (text) => ({ ...message, toolData: { ...toolData, content: text } }),
		}
	}

	return null
}

/**
 * `message` with its live body cut to the newest rows that fit `maxRows`,
 * under a marker line saying how many lines are hidden above, or `null` when
 * the message has no live body.
 */
function liveWindow(message: TUIMessage, maxRows: number, columns: number): TUIMessage | null {
	const body = liveBody(message)

	if (!body) {
		return null
	}

	// Measured the way the renderers print it: tabs expanded, no trailing newline.
	const text = sanitizeContent(body.text).replace(/\n+$/, "")
	const bodyRows = Math.max(1, maxRows - LIVE_WINDOW_CHROME_ROWS)
	const { content, hiddenLines } = clampTail(text, bodyRows, columns, body.indent)

	return body.withText(hiddenLines > 0 ? `${hiddenLinesMarker(hiddenLines)}\n${content}` : content)
}

/**
 * Dynamic-tail wrapper around `ChatHistoryItem` that clamps unbounded message
 * bodies to a row budget. If the dynamic tail outgrows the terminal, ink's
 * erase sequences miss the rows that scrolled out of the viewport, leaving
 * permanent duplicates in scrollback (plan: 2026-08-07 clamp dynamic tail).
 * The full body still prints once when the message is promoted to `<Static>`.
 *
 * In the expanded transcript (ctrl+o) the growing body of a running block
 * (thinking, command output, MCP response) is shown through the same clamp,
 * as a window of its newest rows, so the user can watch it stream. Before,
 * the tail always drew such a block collapsed and its content appeared only
 * when the block completed (plan: 2026-09-23 cli live block under ctrl+o).
 * The window is what keeps the tail bounded: an expanded body is never drawn
 * uncut here.
 */
function DynamicTailMessage({
	message,
	maxRows,
	columns,
	continuation = false,
	expanded = false,
}: DynamicTailMessageProps) {
	const live = useMemo(
		() => (expanded ? liveWindow(message, maxRows, columns) : null),
		[expanded, message, maxRows, columns],
	)

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

	if (live) {
		return <ChatHistoryItem message={live} expanded />
	}

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
				<Text dimColor>{hiddenLinesMarker(clamped.hiddenLines)}</Text>
			</Box>
			{body(clamped.message)}
		</Box>
	)
}

export default memo(DynamicTailMessage)
