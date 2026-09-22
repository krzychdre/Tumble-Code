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
	/**
	 * Line cap for the body. Pass `Number.POSITIVE_INFINITY` to print every
	 * line: the slice keeps all of them and the truncated count stays 0, so
	 * no "… +N lines" tail is rendered.
	 */
	maxLines?: number
}

/**
 * Tool/result output row: dim `⎿` connector followed by dim content,
 * truncated to maxLines (default 5) with a dim "… +N lines (ctrl+o)" tail.
 * String children are pre-sanitized before display.
 *
 * The body and the tail sit in a COLUMN. They used to share the default row
 * direction, which laid the tail out as a second column beside the body and
 * one line down, so "… +31 lines" floated at the top right of the block
 * instead of closing it.
 *
 * The tail names ctrl+o unconditionally: it is only ever rendered when
 * something was cut, and every caller lifts `maxLines` to infinity in the
 * expanded transcript, so a cut line always means "there is more behind ctrl+o".
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
			<Box flexDirection="column" flexGrow={1}>
				<Text dimColor color={theme.secondaryText}>
					{visibleLines.join("\n")}
				</Text>
				{truncatedCount > 0 && (
					<Text dimColor color={theme.secondaryText}>
						{figures.ellipsis}
						{` +${truncatedCount} lines (ctrl+o)`}
					</Text>
				)}
			</Box>
		</Box>
	)
}

export default memo(ResultRow)
