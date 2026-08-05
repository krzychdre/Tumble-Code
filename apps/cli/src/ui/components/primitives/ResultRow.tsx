import { memo } from "react"
import { Box, Text } from "ink"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"

/**
 * Sanitize content for terminal display by:
 * - Replacing tab characters with 4 spaces (tabs expand to variable widths in terminals)
 * - Stripping carriage returns that could cause display issues
 */
export function sanitizeContent(text: string): string {
	return text.replace(/\t/g, "    ").replace(/\r/g, "")
}

interface Props {
	children: string
	maxLines?: number
}

/**
 * Tool/result output row: dim `⎿` connector followed by dim content,
 * truncated to maxLines (default 5) with a dim "… +N lines" tail.
 * String children are pre-sanitized before display.
 */
function ResultRow({ children, maxLines = 5 }: Props) {
	const content = sanitizeContent(children)
	const lines = content.split("\n")
	const totalLines = lines.length

	const visibleLines = lines.slice(0, Math.max(0, maxLines))
	const truncatedCount = Math.max(0, totalLines - visibleLines.length)

	return (
		<Box flexDirection="row">
			<Text dimColor>
				{"  "}
				{figures.elbow}
				{"  "}
			</Text>
			<Box flexGrow={1}>
				<Text dimColor color={theme.secondaryText}>
					{visibleLines.join("\n")}
				</Text>
				{truncatedCount > 0 && (
					<Text dimColor color={theme.secondaryText}>
						{"\n"}
						{"…"}
						{` +${truncatedCount} lines`}
					</Text>
				)}
			</Box>
		</Box>
	)
}

export default memo(ResultRow)
