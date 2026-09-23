import { Box, Text, useStdout } from "ink"

import { figures } from "../../figures.js"
import Bullet from "../primitives/Bullet.js"
import ResultRow from "../primitives/ResultRow.js"

import type { ToolRendererProps } from "./types.js"
import { toolStatusFromMessage } from "./types.js"
import { sanitizeContent } from "./utils.js"

/**
 * Output lines kept in the collapsed row: none. The row says WHAT ran, and
 * the "⎿ … +N lines (ctrl+o)" counter says how much it printed; the output
 * itself is one keystroke away. A preview of a few lines was noise that
 * pushed the answer off the screen, and the model reads the output anyway.
 */
const MAX_OUTPUT_LINES = 0

/** Columns the bullet column takes before the row's own content starts. */
const BULLET_INSET = 2

/** One-line form of a command: newlines and runs of blanks become one space. */
function flattenCommand(command: string): string {
	return command.replace(/\s+/g, " ").trim()
}

/**
 * Cut a flattened command so that `Bash(<command>)` fits one terminal row.
 *
 * Done by hand rather than left to ink's `wrap="truncate-end"`, which hands the
 * text one column more than the row has left and so pushes the header onto a
 * second row (plan: 2026-09-22 CLI diffs render without colours, the ink
 * geometry trap).
 */
function truncateCommand(command: string, columns: number): string {
	const decoration = "Bash()".length
	const available = Math.max(8, columns - BULLET_INSET) - decoration

	if (command.length <= available) {
		return command
	}

	return `${command.slice(0, Math.max(0, available - 1))}${figures.ellipsis}`
}

export function CommandTool({ toolData, message, expanded = false }: ToolRendererProps) {
	const { stdout } = useStdout()
	const columns = stdout?.columns || 80
	const status = toolStatusFromMessage(message)
	const maxOutputLines = expanded ? Number.POSITIVE_INFINITY : MAX_OUTPUT_LINES
	const command = toolData.command ? sanitizeContent(toolData.command).trim() : ""
	const output = toolData.output ? sanitizeContent(toolData.output) : ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	// Trailing newlines are an artifact of the shell, not a line of output, and
	// counting them would inflate the "… +N lines" tail by one.
	const displayOutput = (output || content).replace(/\n+$/, "")
	// Collapsed: one line, cut to the terminal width. Expanded: verbatim, so a
	// heredoc or a `python3 -c "…"` block stays readable across its own lines.
	const displayCommand = expanded ? command : truncateCommand(flattenCommand(command), columns)

	return (
		<Box flexDirection="column">
			<Box>
				<Bullet status={status} />
				<Box flexDirection="column" flexGrow={1}>
					<Text wrap={expanded ? "wrap" : "truncate-end"}>
						<Text bold>Bash</Text>
						{displayCommand ? <Text>({displayCommand})</Text> : null}
					</Text>
					{displayOutput && <ResultRow maxLines={maxOutputLines}>{displayOutput}</ResultRow>}
				</Box>
			</Box>
		</Box>
	)
}
