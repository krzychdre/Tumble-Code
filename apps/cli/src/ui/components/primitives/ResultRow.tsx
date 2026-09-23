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

/**
 * The faint `  ⎿  ` connector in front of a result body.
 *
 * It must not shrink (plan: 2026-09-22 cli bash row overflows width). Next
 * to a body wider than the terminal, yoga shrinks every flex item of the row
 * in proportion, the connector included, so it got 4 columns instead of 5.
 * Ink still prints all 5, which left the body one column too wide: every
 * wrapped row spilled its last character onto a row of its own. The rows
 * ink does not know about then survive its erase in the live tail, so the
 * running `Bash(…)` header stayed in scrollback above the finished one.
 */
export function ElbowGutter({ color = theme.faint }: { color?: string }) {
	return (
		<Box flexShrink={0}>
			<Text color={color}>
				{"  "}
				{figures.elbow}
				{"  "}
			</Text>
		</Box>
	)
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
 * Tool/result output row: faint `⎿` connector followed by faint content,
 * truncated to maxLines (default 5) with a faint "… +N lines (ctrl+o)" tail.
 * `maxLines={0}` prints the connector and the tail alone, which is how Bash
 * and MCP rows hide their output until ctrl+o. String children are
 * pre-sanitized before display.
 *
 * The body and the tail sit in a COLUMN. They used to share the default row
 * direction, which laid the tail out as a second column beside the body and
 * one line down, so "… +31 lines" floated at the top right of the block
 * instead of closing it.
 *
 * The tail names ctrl+o unconditionally: it is only ever rendered when
 * something was cut, and every caller lifts `maxLines` to infinity in the
 * expanded transcript, so a cut line always means "there is more behind ctrl+o".
 *
 * A capped row caps screen rows, not just lines (plan: 2026-09-22 cli bash
 * row overflows width): each line is cut to one row with an ellipsis, because
 * a single 4000-character line (a page scraped with curl) otherwise wraps into
 * twenty rows and the "collapsed" row fills the screen. Uncapped (ctrl+o),
 * lines wrap in full as before.
 */
function ResultRow({ children, maxLines = 5 }: Props) {
	const content = sanitizeContent(children)
	const lines = content.split("\n")
	const totalLines = lines.length

	const visibleLines = lines.slice(0, Math.max(0, maxLines))
	const truncatedCount = Math.max(0, totalLines - visibleLines.length)
	const capped = Number.isFinite(maxLines)

	return (
		<Box flexDirection="row">
			<ElbowGutter />
			<Box flexDirection="column" flexGrow={1}>
				{capped ? (
					visibleLines.map((line, index) => (
						// An empty Text renders no row at all, so a blank line
						// keeps its row with a space.
						<Text key={index} color={theme.faint} wrap="truncate-end">
							{line || " "}
						</Text>
					))
				) : (
					<Text color={theme.faint}>{visibleLines.join("\n")}</Text>
				)}
				{truncatedCount > 0 && (
					<Text color={theme.faint}>
						{figures.ellipsis}
						{` +${truncatedCount} ${truncatedCount === 1 ? "line" : "lines"} (ctrl+o)`}
					</Text>
				)}
			</Box>
		</Box>
	)
}

export default memo(ResultRow)
