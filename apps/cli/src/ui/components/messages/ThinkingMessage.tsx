import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"

import { sanitizeContent } from "../primitives/ResultRow.js"

interface ThinkingMessageProps {
	/** The reasoning text. Only ever shown in expanded mode. */
	content?: string
	/**
	 * Verbose rendering: print the reasoning body under the header. In the
	 * dynamic tail only with a body already cut to the tail's row budget
	 * (plan: 2026-09-23 cli live block under ctrl+o).
	 */
	expanded?: boolean
}

/**
 * Thinking indicator. Collapsed (default) it is the faint italic one-liner
 * "∴ Thinking…". Expanded with non-empty content it becomes a "∴ Thinking"
 * header plus the reasoning body, faint italic, indented under the header.
 * The body is plain Text, not Markdown: reasoning is free text and Markdown
 * would eat asterisks and underscores.
 */
function ThinkingMessage({ content = "", expanded = false }: ThinkingMessageProps) {
	const body = expanded ? sanitizeContent(content).trim() : ""

	if (!body) {
		return (
			<Box paddingLeft={2}>
				<Text color={theme.faint} italic>
					{figures.therefore} Thinking…
				</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column">
			<Box paddingLeft={2}>
				<Text color={theme.faint} italic>
					{figures.therefore} Thinking
				</Text>
			</Box>
			<Box paddingLeft={4}>
				<Text color={theme.faint} italic wrap="wrap">
					{body}
				</Text>
			</Box>
		</Box>
	)
}

export default memo(ThinkingMessage)
