import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"

import { sanitizeContent } from "../primitives/ResultRow.js"

interface ThinkingMessageProps {
	/** The reasoning text. Only ever shown in expanded mode. */
	content?: string
	/**
	 * Verbose rendering: print the reasoning body under the header. Only ever
	 * set for `<Static>` items; the dynamic tail must keep the one-liner
	 * (plan: 2026-09-21 answer lost in dynamic tail, I1 and I8).
	 */
	expanded?: boolean
}

/**
 * Thinking indicator. Collapsed (default) it is the dim italic one-liner
 * "∴ Thinking…". Expanded with non-empty content it becomes a "∴ Thinking"
 * header plus the reasoning body, dim italic, indented under the header.
 * The body is plain Text, not Markdown: reasoning is free text and Markdown
 * would eat asterisks and underscores.
 */
function ThinkingMessage({ content = "", expanded = false }: ThinkingMessageProps) {
	const body = expanded ? sanitizeContent(content).trim() : ""

	if (!body) {
		return (
			<Box paddingLeft={2}>
				<Text dimColor italic>
					{figures.therefore} Thinking…
				</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column">
			<Box paddingLeft={2}>
				<Text dimColor italic>
					{figures.therefore} Thinking
				</Text>
			</Box>
			<Box paddingLeft={4}>
				<Text dimColor italic wrap="wrap">
					{body}
				</Text>
			</Box>
		</Box>
	)
}

export default memo(ThinkingMessage)
